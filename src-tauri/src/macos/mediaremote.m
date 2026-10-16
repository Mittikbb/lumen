// "Now playing" on macOS, from MediaRemote (the private framework behind the
// Now Playing widget in Control Center). Since macOS 15.4 it answers only
// Apple's own processes, so this file is built into a dylib that Lumen runs
// inside /usr/bin/perl (Apple-signed, and it loads extension libraries): the
// same trick as github.com/ungive/mediaremote-adapter.
//
// Protocol, one JSON object per line:
// - stdout: the current track whenever it changes, `{}` when nothing plays.
//   The cover goes out only when it changes (`artwork`, base64); `artworkId`
//   names the one that's current.
// - stdin: "toggle", "next" or "previous". End of input (Lumen quit) exits.

#import <Foundation/Foundation.h>
#include <dlfcn.h>
#include <stdio.h>

typedef void (*RegisterFn)(dispatch_queue_t);
typedef void (*GetInfoFn)(dispatch_queue_t, void (^)(NSDictionary *));
typedef void (*IsPlayingFn)(dispatch_queue_t, void (^)(Boolean));
typedef void (*GetClientFn)(dispatch_queue_t, void (^)(id));
typedef CFStringRef (*ClientIdFn)(id);
typedef Boolean (*SendCommandFn)(int, CFDictionaryRef);

static RegisterFn mr_register;
static GetInfoFn mr_info;
static IsPlayingFn mr_is_playing;
static GetClientFn mr_client;
static ClientIdFn mr_client_id;
static ClientIdFn mr_client_parent_id;
static SendCommandFn mr_send;

static NSString *last_line;
static NSUInteger last_artwork;
static BOOL refresh_pending;

// MRMediaRemoteCommand values.
enum { CMD_TOGGLE = 2, CMD_NEXT = 4, CMD_PREVIOUS = 5 };

static void print_line(NSString *line) {
    const char *utf8 = line.UTF8String;
    fwrite(utf8, 1, strlen(utf8), stdout);
    fputc('\n', stdout);
    fflush(stdout);
}

static NSString *json(NSDictionary *object) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:object options:0 error:nil];
    return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"{}";
}

/// The app behind the track; for a web page, the browser rather than its helper.
static NSString *client_id(id client) {
    if (!client) return @"";
    CFStringRef parent = mr_client_parent_id ? mr_client_parent_id(client) : NULL;
    CFStringRef own = mr_client_id ? mr_client_id(client) : NULL;
    NSString *id_ = (__bridge NSString *)(parent ?: own);
    return id_ ?: @"";
}

static void report(NSString *app, Boolean playing, NSDictionary *info) {
    NSString *title = info[@"kMRMediaRemoteNowPlayingInfoTitle"] ?: @"";
    NSString *artist = info[@"kMRMediaRemoteNowPlayingInfoArtist"] ?: @"";
    if (title.length == 0 && artist.length == 0) {
        if (![last_line isEqualToString:@"{}"]) {
            last_line = @"{}";
            last_artwork = 0;
            print_line(last_line);
        }
        return;
    }

    NSDate *at = info[@"kMRMediaRemoteNowPlayingInfoTimestamp"];
    NSData *artwork = info[@"kMRMediaRemoteNowPlayingInfoArtworkData"];
    NSUInteger artwork_id = artwork.length ? (artwork.hash ^ artwork.length) : 0;
    NSMutableDictionary *track = [@{
        @"title": title,
        @"artist": artist,
        @"app": app,
        @"playing": playing ? @YES : @NO,
        @"duration": info[@"kMRMediaRemoteNowPlayingInfoDuration"] ?: @0,
        @"elapsed": info[@"kMRMediaRemoteNowPlayingInfoElapsedTime"] ?: @0,
        @"at": @(at ? at.timeIntervalSince1970 * 1000.0 : 0),
        @"rate": info[@"kMRMediaRemoteNowPlayingInfoPlaybackRate"] ?: @0,
        @"artworkId": @(artwork_id),
    } mutableCopy];

    NSString *line = json(track);
    if ([line isEqualToString:last_line]) return;
    last_line = line;
    if (artwork_id != last_artwork) {
        last_artwork = artwork_id;
        if (artwork_id) track[@"artwork"] = [artwork base64EncodedStringWithOptions:0];
        line = json(track);
    }
    print_line(line);
}

/// Reads the player, its state and its track, and reports them.
static void refresh(void) {
    refresh_pending = NO;
    mr_client(dispatch_get_main_queue(), ^(id client) {
        NSString *app = client_id(client);
        mr_is_playing(dispatch_get_main_queue(), ^(Boolean playing) {
            mr_info(dispatch_get_main_queue(), ^(NSDictionary *info) {
                report(app, playing, info ?: @{});
            });
        });
    });
}

/// Notifications come in bursts (a new track changes everything at once):
/// one read shortly after the first.
static void schedule_refresh(void) {
    if (refresh_pending) return;
    refresh_pending = YES;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 80 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
        refresh();
    });
}

static void read_commands(void) {
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        char buf[64];
        while (fgets(buf, sizeof buf, stdin)) {
            int command = -1;
            if (strncmp(buf, "toggle", 6) == 0) command = CMD_TOGGLE;
            else if (strncmp(buf, "next", 4) == 0) command = CMD_NEXT;
            else if (strncmp(buf, "previous", 8) == 0) command = CMD_PREVIOUS;
            if (command >= 0) mr_send(command, NULL);
        }
        exit(0);
    });
}

// Called from perl as an XSUB (its interpreter and CV are unused); never returns.
__attribute__((visibility("default"))) void lumen_mediaremote_stream(void *perl, void *cv) {
    (void)perl;
    (void)cv;
    void *mr = dlopen("/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote", RTLD_NOW);
    if (!mr) {
        fprintf(stderr, "MediaRemote: %s\n", dlerror());
        exit(1);
    }
    mr_register = (RegisterFn)dlsym(mr, "MRMediaRemoteRegisterForNowPlayingNotifications");
    mr_info = (GetInfoFn)dlsym(mr, "MRMediaRemoteGetNowPlayingInfo");
    mr_is_playing = (IsPlayingFn)dlsym(mr, "MRMediaRemoteGetNowPlayingApplicationIsPlaying");
    mr_client = (GetClientFn)dlsym(mr, "MRMediaRemoteGetNowPlayingClient");
    mr_client_id = (ClientIdFn)dlsym(mr, "MRNowPlayingClientGetBundleIdentifier");
    mr_client_parent_id = (ClientIdFn)dlsym(mr, "MRNowPlayingClientGetParentAppBundleIdentifier");
    mr_send = (SendCommandFn)dlsym(mr, "MRMediaRemoteSendCommand");
    if (!mr_register || !mr_info || !mr_is_playing || !mr_client || !mr_send) {
        fprintf(stderr, "MediaRemote: missing functions\n");
        exit(1);
    }

    mr_register(dispatch_get_main_queue());
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    for (NSString *name in @[
             @"kMRMediaRemoteNowPlayingInfoDidChangeNotification",
             @"kMRMediaRemoteNowPlayingApplicationIsPlayingDidChangeNotification",
             @"kMRMediaRemoteNowPlayingApplicationDidChangeNotification",
         ]) {
        [center addObserverForName:name
                            object:nil
                             queue:NSOperationQueue.mainQueue
                        usingBlock:^(NSNotification *note) {
                            (void)note;
                            schedule_refresh();
                        }];
    }
    // A safety net for players whose changes don't notify.
    dispatch_source_t timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
    dispatch_source_set_timer(timer, DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC, NSEC_PER_SEC / 2);
    dispatch_source_set_event_handler(timer, ^{
        schedule_refresh();
    });
    dispatch_resume(timer);

    read_commands();
    CFRunLoopRun();
    exit(0);
}
