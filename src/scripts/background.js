import ext from "./utils/ext";
import storage from "./utils/storage";

console.log('Lift off of the Background!');

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
			`https://*/*${encodeURIComponent('www.youtube.com/watch')}*`
		]
	});
	

});


// Define config constant
const config = {
	SUPPORTED_PORTS: [8791,8238,8753],
	SUPPORTED_HOSTNAMES: ['youtube', 'potato'],
	NATIVE_APP_INSTALL_URL: 'https://vikborges.com',
	STORAGE_KEY_NATIVE_APP_PORT : 'fd_native_app_port',
}

let NATIVE_APP_PORT = null;
let current_tab = null;

// get native app default port from storage if not get default one from config
storage.get(config.STORAGE_KEY_NATIVE_APP_PORT, result =>{

	// get port
	let NATIVE_APP_PORT = result[config.STORAGE_KEY_NATIVE_APP_PORT];

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
	ext.tabs.executeScript(null, {file: "scripts/actions_on_videos.js"});

	current_tab = tab;
	
	if(NATIVE_APP_PORT){
		// Send POST request to open video
		openVideoRequest(tab.url);

	}else{
		// PING NATIVE APP
		pingNativeAppServer();

	}

});


// on context menu click
ext.contextMenus.onClicked.addListener((object_info, tab) =>{
	console.debug('Context Menu cliked: ', object_info);

	/*// parser for url
	let parser = document.createElement('a');
	parser.href = decodeURIComponent(object_info.linkUrl || object_info.selectionText);

	// get 'cleaned' url
	let cleaned_url = getCleanedUrl(parser.href);

	if(cleaned_url){
		// Set current_tab url
		current_tab = {url: cleaned_url};

		// Open video request
		openVideoRequest(cleaned_url);
	}
*/
});



//*****************************************************
//			   Native app functions						   
//									  				   				
//*****************************************************
/**
 * Send request to native app to open video panel
 * @param  {[string]} url 
 * @return {[type]}     
 */
function openVideoRequest(url){

	let payload = {};
	let port = NATIVE_APP_PORT;

	payload.video_url = url;
	
	// Get video type
	payload.video_type = getVideoType(url);

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
	console.log('Get video type of: ', url);
	let result;

	// Go over supported hostnames
	config.SUPPORTED_HOSTNAMES.forEach(host =>{
		// build reg rexp to match host in url
		let match_exp = RegExp(`https:\\/\\/(www)?\\.${host}\\..+`,'g');
		console.log('Match RegExp: ', match_exp);

		// execute it
		let matched_val = url.match(match_exp);
		console.log('Match result: ', matched_val);

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
