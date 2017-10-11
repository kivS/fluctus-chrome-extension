console.log('Lift off of the Background!!');

// Define config constant
const config = {
	SUPPORTED_PORTS: [8791,8238,8753],
	SUPPORTED_HOSTNAMES:[
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
	STORAGE_KEY_NATIVE_APP_PORT : 'fd_native_app_port',
}

let NATIVE_APP_PORT = null;
let current_tab = null;

// On install or upgrade
chrome.runtime.onInstalled.addListener(() =>{
	// Replace all rules for filtering page depending on content
	chrome['declarativeContent'].onPageChanged.removeRules(undefined, () => {
		// With a new rule
		chrome['declarativeContent'].onPageChanged.addRules([
		 	{
		 		// Youtube Trigger me!!
		 		conditions: [
		 			// Youtube Trigger me!!
		 			new chrome['declarativeContent'].PageStateMatcher({
		 				pageUrl: { hostContains: 'youtube',  pathContains: 'watch' }
		 			}),

					// Vimeo Trigger me!!
					new chrome['declarativeContent'].PageStateMatcher({
		 				pageUrl: { hostContains: 'vimeo' },
		 				css: ['video']
		 			}),

	 				// soundcloud Trigger me!!
					new chrome['declarativeContent'].PageStateMatcher({
		 				pageUrl: { hostContains: 'soundcloud' },
		 				css: ['div.waveform__scene']
		 			}),

		 			// Twitch Trigger me!!
					new chrome['declarativeContent'].PageStateMatcher({
		 				pageUrl: { urlMatches: 'https://go.twitch.tv/[a-zA-Z0-9_]{4,25}$' },
		 				
		 			}),
		 			new chrome['declarativeContent'].PageStateMatcher({
		 				pageUrl: { urlMatches: 'https://go.twitch.tv/videos/\\d+$' },
		 				
		 			})
		 		],

		 		// Shows the page_action
		 		actions: [
		 			new chrome['declarativeContent'].ShowPageAction()

		 		]
		 	}
		]);
	});

	// Add contextMenus
	chrome.contextMenus.create({
		id: 'contextMenu_1',
		title: chrome.i18n.getMessage("titleOnAction"),
		contexts: ['link', 'selection'],
		targetUrlPatterns: [
			// YOUTUBE
			// For clean urls links like in youtube page and etc
			'https://www.youtube.com/watch*',
			// For dirty urls like in google search results..dirty..
			`https://*/*${encodeURIComponent('www.youtube.com/watch')}*`,

			// VIMEO
			'https://*.vimeo.com/*',
			// For dirty urls like in google search results..dirty..
			`https://*/*${encodeURIComponent('vimeo')}*`,

			// SOUNDCLOUD
			'https://*.soundcloud.com/*',
			// For dirty urls like in google search results..dirty..
			`https://*/*${encodeURIComponent('soundcloud')}*`,

			// TWITCH
			'https://*.twitch.tv/*',
			// For dirty urls like in google search results..dirty..
			`https://*/*${encodeURIComponent('twitch')}*`,
		]
	});


});



// get native app default port from storage if not get default one from config
chrome.storage.sync.get(config.STORAGE_KEY_NATIVE_APP_PORT, result =>{

	// get port
	NATIVE_APP_PORT = result[config.STORAGE_KEY_NATIVE_APP_PORT];

	if(!NATIVE_APP_PORT){
		// Set last value of supported ports array as default
		NATIVE_APP_PORT = config.SUPPORTED_PORTS[config.SUPPORTED_PORTS.length-1];

		// Save to storage
		setNativeAppPortToStorage(NATIVE_APP_PORT);
	}

	console.log('Using default native port:', NATIVE_APP_PORT);

});



/**
 * On btn press lets: 
 * - stop the video, 
 * - get current video ellapsed time, 
 * - get the current url tab 
 * - make a openVideo request 
 */
chrome.pageAction.onClicked.addListener( tab => {
	console.debug('page_action clicked..', tab);

	// pause current video
	chrome.tabs.executeScript(null, {code: "document.getElementsByTagName('video')[0].pause()"});

	// get current video time
	new Promise((resolve) => {
		chrome.tabs.executeScript(null, {code: "document.getElementsByTagName('video')[0].currentTime"}, result =>{
			resolve(parseInt(result[0]));
		});

	}).then(currentTime =>{
			console.debug('current video time: ', currentTime);

			current_tab = tab;

			if(NATIVE_APP_PORT){
				// Send POST request to open video with current video time
				openVideoRequest(tab.url, currentTime);

			}else{
				// PING NATIVE APP
				pingNativeAppServer();

			}

	})

});


/**
 * On text selected/ or item and mouse right-click(context menu) lets:
 * - get linkUrl in case item is a link or get the selected text
 * -  
 */
chrome.contextMenus.onClicked.addListener((object_info, tab) =>{
	console.debug('Context Menu cliked: ', object_info);

	// parser for url
	let parser = parseUrl(object_info.linkUrl || object_info.selectionText);

	// get 'cleaned' url
	let cleaned_url = getCleanedUrl(parser.href);

	if(cleaned_url){
		// Set current_tab url
		current_tab = {url: cleaned_url};

		// Open video request
		openVideoRequest(cleaned_url);
	}



});





//*****************************************************
//			   Native app functions
//
//*****************************************************
/**
 * Send request to native app to open video panel
 * @param  {[string]} url
 * @param  {[string]} current video time
 */
function openVideoRequest(url, currentTime?){

	// get media provider like youtube, vimeo
	const media_provider = getMediaProvider(url);

	if(!media_provider){
		alert('provider not supported..');
		return;
	}

	// get payload for start_player request
	const payload = getPayload(media_provider, url, currentTime);
	console.log('Payload to send: ', payload);

	// Make request
	fetch(`http://localhost:${NATIVE_APP_PORT}/start_player`,{
		method: 'POST',
		headers: new Headers({"Content-Type": "application/json"}),
		body: JSON.stringify(payload)
	})
	.then(response =>{
		return response.json()
	})
	.then(response_data => {

		console.info('Video start request sent!');

		if(response_data.status != "ok"){
			alert(response_data.status);	
		}	
		
	})
	.catch(err => {
		console.error('Failed to send request to native app: ', err);

		// If request fails let's reset default native app port, that way we'll have to ping for new port
		NATIVE_APP_PORT = null;
		setNativeAppPortToStorage("");

		// Ping server again
		console.log('Trying to connect again...');
		pingNativeAppServer();

	});

}



/**
 * Ping native app server
 *
 */
function pingNativeAppServer(){

	let ping_urls = config.SUPPORTED_PORTS.map(port =>{
		return [`http://localhost:${port}/ping`, port];
	})

	Promise.all(ping_urls.map(url =>
			fetch(url[0].toString())
				.then(response =>{
					if(response.ok){
						// If server is found let's return the port
						return url[1];
					}
				})
				.catch(error =>{
					console.warn(`${url[0]}: was not the chosen one!`);
					return null;
				})
		))
		.then(responses =>{
			// Check promises for port
			let port = responses.filter(r => r != null)[0];
			if(port){
				console.log('pinged server successfully on port: ', port);

				// Cache server port
				NATIVE_APP_PORT = port;
				setNativeAppPortToStorage(port);

				// Send POST request to open video
				openVideoRequest(current_tab.url);

			}else{
				// No server found
				showNoServerErrorMsg();
			}
		})
		.catch(err =>{
			console.error('Something went wrong...', err);
		});
}




//			   Helper functions
//
//*****************************************************

/**
 * Given a media provider like youtube or soundcloud, a url & maybe the video's ellapsed time lets:
 * - build & return payload object 
 * 
 * @param {[type]} media_provider [description]
 * @param {[type]} url            [description]
 * @param {[type]} currentTime    [description]
 */
function getPayload(media_provider, url, currentTime?){

	let payload = {};

	// default - player_type 
	payload['player_type'] = media_provider;

	switch (media_provider) {

		case "youtube":
	
			//  if url is 'short-url' lets replace it with full url
			payload['video_url'] = url.replace('youtu.be/', 'www.youtube.com/watch?v=');
			// video time
			if(currentTime) payload['video_currentTime'] = currentTime;

		break;


		case "vimeo":
			// video url
			payload['video_url'] = url;
			// video time
			if(currentTime) payload['time'] = currentTime;
		break;

		case "soundcloud":
			// url
			payload['url'] = url;
		break;

		case "twitch":
			// get player channel
			let channel_regexp_match = url.match(RegExp('https://go.twitch.tv/([a-zA-Z0-9_]{4,25}$)'));
			console.log('Channel match regexp:', channel_regexp_match);
			if(channel_regexp_match) payload['channel_id'] = channel_regexp_match[1];

			// get video id
			let video_regexp_match = url.match(RegExp('https://go.twitch.tv/videos/(\\d+$)'));
			console.log('video match regexp:', video_regexp_match);
			if(video_regexp_match) payload['video_id'] = `v${video_regexp_match[1]}`;

		break;
		
	}

	return payload;
}




/**
 * Save native_app_port to storage
 * @param  {[string]} port
 */
function setNativeAppPortToStorage(port){
	const objToStore = {};

	objToStore[config.STORAGE_KEY_NATIVE_APP_PORT] = port;

	chrome.storage.sync.set(objToStore);

}


/**
 * Given an url lets:
 * - go over our supported hosts(eg: youtube, soundcloud)
 * - if url matches supported host.alt lets return host name
 * 
 * @param  url 
 * @return host name or null
 */
function getMediaProvider(url){
	console.debug('Get video type of: ', url);

	let result = null;

	// Go over supported hostnames
	config.SUPPORTED_HOSTNAMES.forEach(host =>{

		host.alts.forEach(alt =>{
			// build reg rexp to match host in url
			let match_exp = RegExp(`https:\\/\\/(www)?\\.?${alt}\\..+`,'g');
			console.debug('Match RegExp: ', match_exp);

			// execute it
			let matched_val = url.match(match_exp);
			console.debug('Match result: ', matched_val);

			if(matched_val) result = host.name;

		})

	});

	return result;
}




/**
 * Shows dialog to user if server is not alive
 * and lets link to download page for the native app
 *
 */
function showNoServerErrorMsg(){
	if(confirm(chrome.i18n.getMessage("noServerError"))){
		chrome.tabs.create({ url: config.NATIVE_APP_INSTALL_URL });
	}
}


/**
 * Checks if url is allowed and cleans dirty url(like those from a google search) if there's a need for it
 * @param  {[string]} dirty_url --> Presumable dirty link
 * @return {[string || null]}   --> clean url or if it's not allowed null
 */
function getCleanedUrl(dirty_url){
	console.log('Url :', dirty_url);

	// url object
	let parsed_dirty_url = parseUrl(dirty_url);

	if(isHostnameSupported(parsed_dirty_url.hostname)){
		console.log(`Hostname: ${parsed_dirty_url.hostname} is supported!`);
		// If dirty_url is already supported lets return it
		return dirty_url;

	}else{
		console.log(`Hostname: ${parsed_dirty_url.hostname} is not supported.. let\s try to retrieve clean  url from it`);

		// Get clean url if its hostname is supported
		let clean_url;

		try{

			clean_url = getSupportedUrlFromDirtyUrl(parsed_dirty_url.search);

			// Eat my own tail
			return getCleanedUrl(clean_url);

		}catch(e){
			alert(chrome.i18n.getMessage("urlNotSupportedError"));
		}
	}

}


/**
 * Parses url and returns object with url's various components
 * @param  {[string]} url
 * @return {[object]}     -> Url object
 */
function parseUrl(url){
	let parser = document.createElement('a');
	parser.href = decodeURIComponent(url);

	return parser;
}


/**
 * Checks if hostname is supported by the program
 * @param  {[string]}  hostname
 * @return {Boolean}
 */
function isHostnameSupported(hostname){
	let isIt = null;

	// for each supported hostname config check if it's present in hostname -> (*.host.*) == "www.host.com"
	isIt = config.SUPPORTED_HOSTNAMES.filter(host => RegExp(`.*\\.?${host}\\..*`).test(hostname) == true);

	return isIt != false;
}

/**
 * Retrieves supported url from dirty url search param
 * @param  {[string]} url_search --> url search object of dirty url
 * @return {[string]}    --> supported Url
 */
function getSupportedUrlFromDirtyUrl(url_search){
	console.log('Dirty url\'s search object: ', url_search);

	let result = null;

	// For each hostname in supported array let's match against url_search and retrieve the url
	config.SUPPORTED_HOSTNAMES.forEach(host =>{

		let match_exp = RegExp(`https:\\/\\/(www)?\\.?${host}\\..+`,'g');
		console.log('Match RegExp: ', match_exp);

		let matched_val = url_search.match(match_exp);
		console.log('Match result: ', matched_val);

		if(matched_val) return result = matched_val[0];

	});

	if(!result) throw `No match for dirty url: ${url_search}`;

	return result;
}
