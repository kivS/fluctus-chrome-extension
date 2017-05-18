import ext from "./utils/ext";
import storage from "./utils/storage";

console.log('Lift off of the Background!!');

// On install or upgrade
ext.runtime.onInstalled.addListener(() =>{
	// @if extension = 'chrome'
	// Replace all rules for filtering page depending on content
	chrome.declarativeContent.onPageChanged.removeRules(undefined, () => {
		// With a new rule
		chrome.declarativeContent.onPageChanged.addRules([
		 	{
		 		// Youtube Trigger me!!
		 		conditions: [
		 			new chrome.declarativeContent.PageStateMatcher({
		 				pageUrl: { hostContains: 'youtube',  pathContains: 'watch' }
		 			}),

					// Vimeo Tigger me!!
					new chrome.declarativeContent.PageStateMatcher({
		 				pageUrl: { hostContains: 'vimeo' },
		 				css: ['video']
		 			})
		 		],

		 		// Shows the page_action
		 		actions: [
		 			new chrome.declarativeContent.ShowPageAction()

		 		]
		 	}
		]);
	});
	// @endif

	// Add contextMenus
	ext.contextMenus.create({
		id: 'contextMenu_1',
		title: ext.i18n.getMessage("titleOnAction"),
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
		]
	});


});


// Define config constant
const config = {
	SUPPORTED_PORTS: [8791,8238,8753],
	SUPPORTED_HOSTNAMES: ['youtube', 'vimeo'],
	NATIVE_APP_INSTALL_URL: 'https://vikborges.com',
	STORAGE_KEY_NATIVE_APP_PORT : 'fd_native_app_port',
}

let NATIVE_APP_PORT = null;
let current_tab = null;


// get native app default port from storage if not get default one from config
storage.get(config.STORAGE_KEY_NATIVE_APP_PORT, result =>{

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



// Page_action click event
ext.pageAction.onClicked.addListener( tab => {
	console.debug('page_action clicked..', tab);

	// pause current video
	ext.tabs.executeScript(null, {code: "document.getElementsByTagName('video')[0].pause()"});

	// get current video time
	new Promise((resolve) => {
		ext.tabs.executeScript(null, {code: "document.getElementsByTagName('video')[0].currentTime"}, result =>{
			resolve(result[0]);
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


// on context menu click
ext.contextMenus.onClicked.addListener((object_info, tab) =>{
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
 * @return {[type]}
 */
function openVideoRequest(url, currentTime = false){

	let payload = {};
	let port = NATIVE_APP_PORT;

	payload.video_url = url;

	// Get video type
	payload.video_type = getVideoType(url);

	// get video current time
	if(currentTime) payload.video_currentTime = currentTime;

	console.log('Payload to send: ', payload);

	// Make request
	fetch(`http://localhost:${port}/start_video`,{
		method: 'POST',
		headers: new Headers({"Content-Type": "application/json"}),
		body: JSON.stringify(payload)
	})
	.then(response =>{
		if(response.ok){
			console.info('Video start request sent!');
		}
	})
	.catch(err => {
		console.error('Failed to send request to native app: ', err);

		// If request fails let's reset default native app port, that way we'll have to ping for new port
		NATIVE_APP_PORT = null;
		setNativeAppPortToStorage("");

		// Ping server again
		console.log('Trying to connect again...');
		pingNativeAppServer(current_tab.url);

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
			fetch(url[0])
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
 * Save native_app_port to storage
 * @param  {[string]} port
 */
function setNativeAppPortToStorage(port){
	const objToStore = {};

	objToStore[config.STORAGE_KEY_NATIVE_APP_PORT] = port;

	storage.set(objToStore);

}


/**
 * Will go over supported hostnames array and get the value corresponding to the url
 * @param  {[type]} url
 * @return {[string]}     --> Type of video
 */
function getVideoType(url){
	console.debug('Get video type of: ', url);
	let result;

	// Go over supported hostnames
	config.SUPPORTED_HOSTNAMES.forEach(host =>{
		// build reg rexp to match host in url
		let match_exp = RegExp(`https:\\/\\/(www)?\\.?${host}\\..+`,'g');
		console.debug('Match RegExp: ', match_exp);

		// execute it
		let matched_val = url.match(match_exp);
		console.debug('Match result: ', matched_val);

		if(matched_val) return result = host;
	});

	if(!result) throw `Video type not found for: ${url}`;

	return result;
}




/**
 * Shows dialog to user if server is not alive
 * and lets link to download page for the native app
 *
 */
function showNoServerErrorMsg(){
	if(confirm(ext.i18n.getMessage("noServerError"))){
		ext.tabs.create({ url: config.NATIVE_APP_INSTALL_URL });
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
			alert(ext.i18n.getMessage("urlNotSupportedError"));
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
