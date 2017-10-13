console.log('Lift off of the Background!!');
var config = {
    SUPPORTED_PORTS: [8791, 8238, 8753],
    SUPPORTED_HOSTNAMES: [
        {
            'name': 'youtube',
            'alts': ['youtube', 'youtu.be']
        },
        {
            'name': 'vimeo',
            'alts': ['vimeo']
        },
        {
            'name': 'soundcloud',
            'alts': ['soundcloud']
        },
        {
            'name': 'twitch',
            'alts': ['twitch', 'go.twitch']
        },
    ],
    NATIVE_APP_INSTALL_URL: 'https://github.com/kivS/Fluctus/releases',
    STORAGE_KEY_NATIVE_APP_PORT: 'fd_native_app_port',
};
var NATIVE_APP_PORT = null;
var current_tab = null;
chrome.runtime.onInstalled.addListener(function () {
    chrome['declarativeContent'].onPageChanged.removeRules(undefined, function () {
        chrome['declarativeContent'].onPageChanged.addRules([
            {
                conditions: [
                    new chrome['declarativeContent'].PageStateMatcher({
                        pageUrl: { hostContains: 'youtube', pathContains: 'watch' }
                    }),
                    new chrome['declarativeContent'].PageStateMatcher({
                        pageUrl: { hostContains: 'vimeo' },
                        css: ['video']
                    }),
                    new chrome['declarativeContent'].PageStateMatcher({
                        pageUrl: { hostContains: 'soundcloud' },
                        css: ['div.waveform__scene']
                    }),
                    new chrome['declarativeContent'].PageStateMatcher({
                        pageUrl: { urlMatches: 'https://go.twitch.tv/[a-zA-Z0-9_]{4,25}$' },
                    }),
                    new chrome['declarativeContent'].PageStateMatcher({
                        pageUrl: { urlMatches: 'https://go.twitch.tv/videos/\\d+$' },
                    })
                ],
                actions: [
                    new chrome['declarativeContent'].ShowPageAction()
                ]
            }
        ]);
    });
    chrome.contextMenus.create({
        id: 'contextMenu_1',
        title: chrome.i18n.getMessage("titleOnAction"),
        contexts: ['link', 'selection'],
        targetUrlPatterns: [
            'https://www.youtube.com/watch*',
            'https://youtu.be/*',
            "https://*/*" + encodeURIComponent('www.youtube.com/watch') + "*",
            'https://*.vimeo.com/*',
            "https://*/*" + encodeURIComponent('vimeo') + "*",
            'https://*.soundcloud.com/*',
            "https://*/*" + encodeURIComponent('soundcloud') + "*",
            'https://go.twitch.tv/videos/*',
            'https://go.twitch.tv/*',
            "https://*/*" + encodeURIComponent('twitch') + "*",
        ]
    });
});
chrome.storage.sync.get(config.STORAGE_KEY_NATIVE_APP_PORT, function (result) {
    NATIVE_APP_PORT = result[config.STORAGE_KEY_NATIVE_APP_PORT];
    if (!NATIVE_APP_PORT) {
        NATIVE_APP_PORT = config.SUPPORTED_PORTS[config.SUPPORTED_PORTS.length - 1];
        setNativeAppPortToStorage(NATIVE_APP_PORT);
    }
    console.log('Using default native port:', NATIVE_APP_PORT);
});
chrome.pageAction.onClicked.addListener(function (tab) {
    console.debug('page_action clicked..', tab);
    chrome.tabs.executeScript(null, { code: "document.getElementsByTagName('video')[0].pause()" });
    new Promise(function (resolve) {
        chrome.tabs.executeScript(null, { code: "document.getElementsByTagName('video')[0].currentTime" }, function (result) {
            resolve(parseInt(result[0]));
        });
    }).then(function (currentTime) {
        console.debug('current video time: ', currentTime);
        if (NATIVE_APP_PORT) {
            openVideoRequest(tab.url, currentTime);
        }
        else {
            pingNativeAppServer(tab.url, currentTime);
        }
    });
});
chrome.contextMenus.onClicked.addListener(function (object_info, tab) {
    console.debug('Context Menu cliked: ', object_info);
    var parser = parseUrl(object_info.linkUrl || object_info.selectionText);
    try {
        var _a = getCleanedUrl(parser.href), hostname = _a[0], cleaned_url = _a[1];
        if (cleaned_url) {
            openVideoRequest(cleaned_url, null, hostname);
        }
    }
    catch (e) {
        console.log('url not supported.');
    }
});
function openVideoRequest(url, currentTime, hostname) {
    if (hostname === void 0) { hostname = null; }
    var media_provider;
    if (hostname) {
        media_provider = hostname;
    }
    else {
        media_provider = getMediaProvider(url)[0];
    }
    if (!media_provider) {
        alert(chrome.i18n.getMessage('mediaProviderNotSupportedError'));
        return;
    }
    var payload = getPayload(media_provider, url, currentTime);
    console.log('Payload to send: ', payload);
    if (Object.keys(payload).length <= 1) {
        alert(chrome.i18n.getMessage('urlNotSupportedError'));
        return;
    }
    fetch("http://localhost:" + NATIVE_APP_PORT + "/start_player", {
        method: 'POST',
        headers: new Headers({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload)
    })
        .then(function (response) {
        return response.json();
    })
        .then(function (response_data) {
        console.info('Video start request sent!');
        if (response_data.status != "ok") {
            alert(response_data.status);
        }
    })
        .catch(function (err) {
        console.error('Failed to send request to native app: ', err);
        NATIVE_APP_PORT = null;
        setNativeAppPortToStorage("");
        console.log('Trying to connect again...');
        pingNativeAppServer(url, currentTime);
    });
}
function pingNativeAppServer(requested_video_url, requested_video_time) {
    var ping_urls = config.SUPPORTED_PORTS.map(function (port) {
        return ["http://localhost:" + port + "/ping", port];
    });
    Promise.all(ping_urls.map(function (url) {
        return fetch(url[0].toString())
            .then(function (response) {
            if (response.ok) {
                return url[1];
            }
        })
            .catch(function (error) {
            console.warn(url[0] + ": was not the chosen one!");
            return null;
        });
    }))
        .then(function (responses) {
        var port = responses.filter(function (r) { return r != null; })[0];
        if (port) {
            console.log('pinged server successfully on port: ', port);
            NATIVE_APP_PORT = port;
            setNativeAppPortToStorage(port);
            openVideoRequest(requested_video_url, requested_video_time);
        }
        else {
            showNoServerErrorMsg();
        }
    })
        .catch(function (err) {
        console.error('Something went wrong...', err);
    });
}
function getPayload(media_provider, url, currentTime) {
    var payload = {};
    payload['player_type'] = media_provider;
    switch (media_provider) {
        case "youtube":
            payload['video_url'] = url.replace('youtu.be/', 'www.youtube.com/watch?v=');
            if (currentTime)
                payload['video_currentTime'] = currentTime;
            break;
        case "vimeo":
            payload['video_url'] = url;
            if (currentTime)
                payload['time'] = currentTime;
            break;
        case "soundcloud":
            payload['url'] = url;
            break;
        case "twitch":
            var channel_regexp_match = url.match(RegExp('https://go.twitch.tv/([a-zA-Z0-9_]{4,25}$)'));
            console.log('Channel match regexp:', channel_regexp_match);
            if (channel_regexp_match)
                payload['channel_id'] = channel_regexp_match[1];
            var video_regexp_match = url.match(RegExp('https://go.twitch.tv/videos/(\\d+$)'));
            console.log('video match regexp:', video_regexp_match);
            if (video_regexp_match)
                payload['video_id'] = "v" + video_regexp_match[1];
            break;
    }
    return payload;
}
function setNativeAppPortToStorage(port) {
    var objToStore = {};
    objToStore[config.STORAGE_KEY_NATIVE_APP_PORT] = port;
    chrome.storage.sync.set(objToStore);
}
function getMediaProvider(url) {
    console.debug('Get video type of: ', url);
    var result = null;
    config.SUPPORTED_HOSTNAMES.forEach(function (host) {
        host.alts.forEach(function (alt) {
            var match_exp = RegExp("(?:https:\\/\\/)?(?:www\\.)?" + alt + "(?:.+)?", 'g');
            console.debug('Match RegExp: ', match_exp);
            var matched_val = url.match(match_exp);
            console.debug('Match result: ', matched_val);
            if (matched_val)
                result = [host.name, matched_val[0]];
        });
    });
    return result;
}
function showNoServerErrorMsg() {
    if (confirm(chrome.i18n.getMessage("noServerError"))) {
        chrome.tabs.create({ url: config.NATIVE_APP_INSTALL_URL });
    }
}
function getCleanedUrl(url_candidate) {
    var url_candidate_obj = parseUrl(url_candidate);
    console.debug('candidate url :', url_candidate_obj);
    var media_provider = getMediaProvider(url_candidate_obj.hostname);
    if (media_provider) {
        console.log("Hostname: " + url_candidate_obj.hostname + " is supported!");
        var hostname = media_provider[0];
        return [hostname, url_candidate];
    }
    else {
        console.log("Hostname: " + url_candidate_obj.hostname + " is not supported.. lets try to retrieve clean url from it");
        try {
            var _a = getMediaProvider(url_candidate_obj.search), hostname = _a[0], clean_url_candidate = _a[1];
            if (!clean_url_candidate)
                throw "No match for dirty url: " + url_candidate_obj.search;
            return [hostname, clean_url_candidate];
        }
        catch (e) {
            alert(chrome.i18n.getMessage("urlNotSupportedError"));
        }
    }
}
function parseUrl(url) {
    var parser = document.createElement('a');
    parser.href = decodeURIComponent(url);
    return parser;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFja2dyb3VuZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImJhY2tncm91bmQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxDQUFDLEdBQUcsQ0FBQyw4QkFBOEIsQ0FBQyxDQUFDO0FBRzVDLElBQU0sTUFBTSxHQUFHO0lBQ2QsZUFBZSxFQUFFLENBQUMsSUFBSSxFQUFDLElBQUksRUFBQyxJQUFJLENBQUM7SUFDakMsbUJBQW1CLEVBQUM7UUFDbkI7WUFDQyxNQUFNLEVBQUUsU0FBUztZQUNqQixNQUFNLEVBQUUsQ0FBQyxTQUFTLEVBQUUsVUFBVSxDQUFDO1NBQy9CO1FBQ0Q7WUFDQyxNQUFNLEVBQUUsT0FBTztZQUNmLE1BQU0sRUFBRSxDQUFDLE9BQU8sQ0FBQztTQUNqQjtRQUNEO1lBQ0MsTUFBTSxFQUFFLFlBQVk7WUFDcEIsTUFBTSxFQUFFLENBQUMsWUFBWSxDQUFDO1NBQ3RCO1FBQ0Q7WUFDQyxNQUFNLEVBQUUsUUFBUTtZQUNoQixNQUFNLEVBQUUsQ0FBQyxRQUFRLEVBQUUsV0FBVyxDQUFDO1NBQy9CO0tBQ0Q7SUFDRCxzQkFBc0IsRUFBRSwwQ0FBMEM7SUFDbEUsMkJBQTJCLEVBQUcsb0JBQW9CO0NBQ2xELENBQUE7QUFFRCxJQUFJLGVBQWUsR0FBRyxJQUFJLENBQUM7QUFDM0IsSUFBSSxXQUFXLEdBQUcsSUFBSSxDQUFDO0FBR3ZCLE1BQU0sQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLFdBQVcsQ0FBQztJQUV0QyxNQUFNLENBQUMsb0JBQW9CLENBQUMsQ0FBQyxhQUFhLENBQUMsV0FBVyxDQUFDLFNBQVMsRUFBRTtRQUVqRSxNQUFNLENBQUMsb0JBQW9CLENBQUMsQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDO1lBQ2xEO2dCQUVDLFVBQVUsRUFBRTtvQkFFWCxJQUFJLE1BQU0sQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLGdCQUFnQixDQUFDO3dCQUNqRCxPQUFPLEVBQUUsRUFBRSxZQUFZLEVBQUUsU0FBUyxF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