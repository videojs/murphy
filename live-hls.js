'use strict';
/**
 * Routes that help simulate live HLS playlists.
 */
const fs = require('fs');
const os = require('os');
const extend = require('lodash').extend;
const path = require('path');
const url = require('url');
const express = require('express');
const https = require('https');
const http = require('http');
var streams = {};
var debug = 1;
var defaults = {
  // seconds per resource, defaults to target duration if no override
  // rate: 10,
  // lines to initially return (This is obsolete)
  init: 4,
  // number of ts files in the sliding window
  window: 5,
  // the number of ts files in each update
  step: 1,
  // the number of dropped media files
  dropped: 0,
  //
  discontinuity: 0,
  //counter (obsolete?)
  counter: 0,
  lastStartPosition: 0,
  tsNotFound: 0,
  manifestnotfound: 0,
  resetStream: 0,
  stopStream: 0,
  calculatedDuration: 0
};
var event;
var manifest = [];
var redirect = [];
var redirectCount = 0;

const debuglog = function(str) {
  if (debug == 1) {
    console.log(str);
  }
};
const getHeaderObjects = function(fileContent) {
  let lines = fileContent.split('\n'),
    indexOfColon,
    header = {
      PlaylistType: {
        tag: '#EXT-X-PLAYLIST-TYPE',
        value: ''
      },
      TargetDuration: {
        tag: '#EXT-X-TARGETDURATION',
        value: 0
      },
      MediaSequence: {
        tag: '#EXT-X-MEDIA-SEQUENCE',
        value: 0
      },
      Discontinuity: {
        tag: '#EXT-X-DISCONTINUITY-SEQUENCE',
        value: 0
      },
      Extra: []
    };
  for(var i = 0;i<lines.length;i++) {
    indexOfColon = lines[i].indexOf(':');
    if (lines[i].indexOf('#EXTM3U') > -1) {
      header.Firstline = '#EXTM3U';
      continue;
    }
    if (lines[i].indexOf('#EXT-X-PLAYLIST-TYPE:') === 0) {
      header.PlaylistType.tag = '#EXT-X-PLAYLIST-TYPE';
      header.PlaylistType.value = lines[i].substr(indexOfColon + 1,lines[i].length-indexOfColon);
      continue;
    }
    if (lines[i].indexOf('#EXT-X-MEDIA-SEQUENCE:') === 0) {
      header.MediaSequence.tag = '#EXT-X-MEDIA-SEQUENCE';
      header.MediaSequence.value = lines[i].substr(indexOfColon + 1,lines[i].length-indexOfColon);
      continue;
    }
    if (lines[i].indexOf('#EXT-X-DISCONTINUITY-SEQUENCE:') === 0) {
      header.Discontinuity.tag = '#EXT-X-DISCONTINUITY-SEQUENCE';
      header.Discontinuity.value = lines[i].substr(indexOfColon + 1,lines[i].length-indexOfColon);
      continue;
    }

    if (lines[i].indexOf('#EXT-X-TARGETDURATION') === 0) {
      header.TargetDuration.tag = '#EXT-X-TARGETDURATION';
      header.TargetDuration.value = lines[i].substr(indexOfColon + 1,lines[i].length-indexOfColon);
      continue;
    }

    if (/(\.aac|\.webvtt|\.vtt|\.ts|#EXT-X-PROGRAM-DATE-TIME|#EXT-INF|#EXT-X-MAP|#EXTINF|EXT-X-BYTERANGE)/i.test(lines[i])) {
      //Breakout because we're no longer in the header
      break;
    }

    if (indexOfColon > 0) {
      header.Extra.push(lines[i]);
    }
  }
  return header;
};

const getSegmentHeader = function(lines, index, event) {
  var i,
    header='',
    byterange='',
    datetime='',
    segment,
    segmentDuration=0;
  for(i = (index - 1); i > 0; i--) {
    //Search backwards from index to get all header lines
    if (lines[i].indexOf('EXT-X-PROGRAM-DATE-TIME') > -1) {
      datetime = lines[i];
    } else if (lines[i].indexOf('EXTINF')>-1) {
      segmentDuration = parseFloat(lines[i].substring(lines[i].indexOf(':')+1).slice(0,-1));
      if (event && event.calculatedDuration) {
        event.calculatedDuration += segmentDuration;
      }
      header=lines[i];
    } else if (lines[i].indexOf('EXT-X-BYTERANGE') > -1) {
      byterange=lines[i];
    } else if (lines[i].indexOf('EXT-X-CUE') > -1 ||
        (lines[i].indexOf('EXT-X-DISCONTINUITY') > -1 && lines[i].indexOf('EXT-X-DISCONTINUITY-SEQUENCE') === -1) ||
        (lines[i].indexOf('EXT-X-MAP') > -1)) {
      header = lines[i] + '\n' + header;
    } else {
      break;
    }
  }
  segment = {
    tsfile: lines[index]
  };
  if (byterange!='') {
    segment.byterange=byterange;
  }
  if (header!='') {
    segment.header=header;
  }
  if (datetime != '') {
    console.log('assign segment.datetime');
    segment.datetime = datetime;
  }
  return segment;
};

const getResources = function(fileContent, request, event, baseurl) {
  var lines = fileContent.split('\n'),
    header,
    file,
    resource = [],
    segment,
    redirectFile,
    ext,
    arr,
    reqpathmod,
    prepend_redirectFile = '',
    i,
    j;
  for (i = 0;i < lines.length;i++) {
    header = null;
    file = null;
    if (/\.(ts|aac|m4s|mp4|vtt|webvtt)/i.test(lines[i])) {
      
      segment = getSegmentHeader(lines, i, event);
      
      file = lines[i].replace(/(\r)/gm,"");
      if (baseurl && file.indexOf('http') === -1) {
        file = baseurl + file;
      }
      if (file.indexOf('http') === 0) {
        arr = file.split('.');
        if (arr.length > 1) {
          ext = arr[arr.length - 1];
        }
        if (request.path) {
          reqpathmod = request.path.substr(0, request.path.lastIndexOf('/') + 1);
        } else {
          reqpathmod = request.query.url.substr(0, request.query.url.lastIndexOf('/') + 1);
        }
        debuglog(reqpathmod);
        debuglog('request path: ' + request.path);
        if (baseurl) {
          var indexOfhttp = baseurl.indexOf('//') + 2;

          redirectFile = 'redirect/' + baseurl.substr(indexOfhttp) + redirectCount + '.' + ext;
          debuglog(redirectFile);
        } else if (request.path) {
          redirectFile = 'redirect' + reqpathmod + redirectCount + '.' + ext;
        }
        redirectCount++;
        redirect[redirectFile] = file;
        debuglog('save redirect: ' + redirectFile + ' - ' + file);
        if (!baseurl) {
          for (j = 0; j < reqpathmod.split('/').length - 1; j++) {
            prepend_redirectFile = prepend_redirectFile + '../';
          }
        }
        file = prepend_redirectFile + redirectFile;
        prepend_redirectFile = '';
        debuglog('file: ' + file);
        segment.tsfile=file;
      }
      resource.push(segment);
    }
  }
  return resource;
};

const getInitialValue = function(allLines) {
  var i;
  for (i = 0;i<allLines.length;i++) {
    if (allLines[i].indexOf('#EXTINF')>-1) {
      return i;
    }
  }
};

const cleanup = function(fileContent) {
  var lines = fileContent.split('\n');
  for (var i = 0;i<lines.length;i++) {
    if (lines[i].indexOf('TOTAL-DURATION') > -1) {
      debuglog('delete line: ' + lines[i]);
      lines.splice(i, 1);
    }
    if (lines[i].indexOf('#EXT-X-ENDLIST') === 0 || lines[i] == '')
    {
      debuglog('delete line: ' + lines[i]);
      lines.splice(i, 1);
    }
  }
  return lines.join('\n');
};

const extractHeader = function(header, event, streamtype) {
  var lines = [];
  lines.push(header.Firstline);
  if (header.PlaylistType) {
    lines.push(header.PlaylistType.tag + ':' + streamtype);
  }
  if (header.TargetDuration) {
    lines.push(header.TargetDuration.tag + ':' + header.TargetDuration.value);
  }
  if (header.MediaSequence) {
    lines.push(header.MediaSequence.tag + ':' + event.dropped);
  }
  if (header.Discontinuity) {
    lines.push(header.Discontinuity.tag + ':' + event.discontinuity);
  }
  if (header.Extra) {
    for(var i = 0;i<header.Extra.length;i++) {
      lines.push(header.Extra[i]);
    }
  }
  return lines;
};

const calculateDatetime = function(event, resource, i) {
  var currentDateTime;
  var DateObject;
  currentDateTime = resource[i].datetime.split('TIME:')[1];
  DateObject = new Date(currentDateTime);
  //Determine if the stream has looped yet
  if (event.dropped > (resource.length-event.window)) {
    //Adjust datetime according to the number of loops have occurred.
    if (event.calculatedDuration > 0) {
      //If we have values based on EXTINF, use the sum of all EXTINF to calculate loop
      DateObject.setSeconds(DateObject.getSeconds() + event.calculatedDuration);
    } else {
      //If we don't have values based on EXTINF, use targetDuration (which event.rate is based on) to calculate loop
      DateObject.setSeconds(DateObject.getSeconds() + (Math.floor((event.dropped + event.window)/resource.length)*event.window)*event.rate);
    }
  }
  debuglog('#EXT-X-PROGRAM-DATE-TIME:' + DateObject.toISOString());
  return DateObject.toISOString();
};

const extractResourceWindow = function(mfest, duration, event, streamtype) {
  var startposition;
  var endposition;
  var overflow = 0;
  var header = mfest.header;
  var resource = mfest.resources;
  var lines;
  var i;
  streamtype = streamtype || 'live';
  startposition = Math.floor((duration * 0.001) / event.rate);
  debuglog('start before mod ' + startposition);
  debuglog('event start '+event.start);
  event.discontinuity=Math.floor(startposition/resource.length);
  event.dropped=startposition;
  if (event.dropped<0) {
    event.dropped=0;
  }
  if (streamtype === 'live') {
    startposition = startposition % resource.length;
    endposition = startposition + event.window-1;
    if (event.lastStartPosition<startposition) {
      debuglog('dropped: ' + event.dropped);
    }
  } else {
    startposition = 0;
    //start at a 3 segment buffer to end position
    endposition = Math.floor((duration * 0.001) / event.rate);
  }

  if (endposition >= resource.length) {
    debuglog('endposition before mod: ' + endposition);
    overflow = endposition - (resource.length - 1);

    endposition = resource.length - 1;
  }
  debuglog('startposition: ' + startposition);
  debuglog('endposition: ' + endposition);
  debuglog('overflow: ' + overflow);
  debuglog('resource length: ' + resource.length);
  debuglog('rate: ' + event.rate);
  lines=extractHeader(header, event, streamtype);
  for(i = startposition; i <= endposition; i++) {
    if (resource[i].header) {
      lines.push(resource[i].header);
    }
    if (resource[i].datetime) {
      lines.push('#EXT-X-PROGRAM-DATE-TIME:' + calculateDatetime(event, resource, i));
    }
    if (resource[i].byterange) {
      lines.push(resource[i].byterange);
    }
    if (resource[i].tsfile) {
      lines.push(resource[i].tsfile);
    }
  }
  if (overflow>0) {
    if (streamtype === 'live') {
      for (i = 0; i < overflow; i++) {
        var referencedResource = i % resource.length;

        if (referencedResource === 0) {
          lines.push('#EXT-X-DISCONTINUITY');
        }
        if (resource[referencedResource].header) {
          lines.push(resource[referencedResource].header);
        }
        if (resource[referencedResource].datetime) {
          lines.push('#EXT-X-PROGRAM-DATE-TIME:' + calculateDatetime(event, resource, i));
        }
        if (resource[referencedResource].byterange) {
          lines.push(resource[referencedResource].byterange);
        }
        if (resource[referencedResource].tsfile) {
          lines.push(resource[referencedResource].tsfile);
        }
      }
    } else {
      lines.push('#EXT-X-ENDLIST');
    }
  }
  event.lastStartPosition = startposition;
  return lines;
};



/**
 * Filter a complete m3u8 playlist and return a view that simulates
 * live playback for the given time.
 * @param playlist {string} the contents of the m3u8 file
 * @param time {number} the amount of time that has passed since the
 * stream began
 * @param options {object} a hash of parameters that affect the timing
 * of the stream
 * @return {string} the lines of the playlist that would be available
 * at the specified time
 */
const filterPlaylist = function(playlist, time, options) {
  var startposition;
  var endposition;
  var overflow = 0;
  var lines = playlist.split('\n');

  options.init=getInitialValue(lines);
  // the number of the time-varying lines to be shown
  var temptime=(time*0.001);


  startposition = options.init+Math.floor(temptime / options.rate);
  options.dropped=startposition;
  debuglog('init: ' + options.init);
  debuglog('time * 0.001 = ' + temptime);
  debuglog('options.rate: ' + options.rate);
  debuglog('(time * 0.001) / options.rate = ' + startposition);
  debuglog('startposition' + startposition + '==options.init' + options.init);
  debuglog(startposition == options.init);

  startposition = startposition - (startposition % options.step);
  if (startposition<options.init) startposition = options.init+1;
  debuglog('startposition' + startposition + '%' + options.step + ' = ' + (startposition%options.step));
  if ((startposition%options.step) == 0) {
    debuglog('dropped: ' + options.dropped);
  }
  debuglog('((startposition' + startposition + '-event.init' + options.init +
    ') % (lines.length' + lines.length + '-event.init' + options.init + ')) + ' +
    'event.init'+options.init+' = ');
  startposition = ((startposition-options.init) % (lines.length-options.init)) + options.init + 1;


  endposition = startposition + options.window;
  debuglog('lines.length: ' + lines.length);
  debuglog('startposition: ' + startposition);
  debuglog('endposition: ' + endposition);

  var filteredLines = lines.slice(0, options.init);
  if (endposition>lines.length) {
    overflow = endposition-lines.length;
    debuglog('overflow: ' + overflow);
  }
  filteredLines = filteredLines.concat(lines.slice(startposition, endposition));
  if (overflow>0) {
    debuglog('overflow: ' + overflow);
    filteredLines[filteredLines.length-1] += '\n#EXT-X-DISCONTINUITY';
    event.discontinuity++;
    debuglog(filteredLines[filteredLines.length-1]);
    filteredLines = filteredLines.concat(lines.slice(options.init, options.init + overflow));
    overflow = 0;
  }
  options.counter++;
  return filteredLines.join('\n');
};

const ui = function(request, response) {
  var result, key, rows = '', resources='', button;
  fs.readFile(path.join(__dirname, 'ui', request.path), function (error, data) {
    if (error) {
      return response.send(404, error);
    }
    result = data.toString();
    for (key in streams) {
      if (key.indexOf('.m3u8') >-1 ) {
        button = '<td><button onclick=\"injectError(\'../'+key.replace('live', 'error')+'?errorcode=1\')\">errortext</button></td>';
        rows += '<tr><td>' + key + '</td>'+
          button.replace('errorcode', 'tsNotFound').replace('errortext','ts404') +
          button.replace('errorcode', 'manifestnotfound').replace('errortext','manifest404') + '</tr>\n';
      }
      if (/\.(ts|aac|m4s|mp4|vtt|webvtt)/i.test(key)) {
        resources += '<tr><td>' + key + '</td></tr>';
      }
    }

    result = result.replace('<!--InjectRows-->', rows);
    result = result.replace('<!--InjectResources-->', resources);

    response.write(result);
    response.status(200);
    response.end();
  })
};

const getStream = function(name) {
  var stream = streams[name];
  console.log('streamname: ' + name);

  // create a new stream if one doesn't already exist
  if (!stream) {
    stream = extend({
      // start time of the stream
      start: Date.now(),
      sequenceOffsets: {},
      manifest: {}
    }, defaults);
    streams[name] = stream;
  }
  return stream;
};

const resetLiveStream = function(name) {
  console.log('resetting stream:', name);
  delete streams[name];
  return getStream(name);
};

const resetAllStreams = function() {
  var streamName;
  for(streamName in streams) {
    resetLiveStream(streamName);
  }
};

const stopLiveStream = function(name) {
  console.log('stop stream:', name);
  delete streams[name];
};

const stopAllStreams = function() {
  var streamName;
  for(streamName in streams) {
    stopLiveStream(streamName);
  }
};

const parseQueryString = function( queryString ) {
  var params = {}, queries, temp, i, l;

  // Split into key/value pairs
  queries = queryString.split("&amp;");

  // Convert the array of strings into an object
  for ( i = 0, l = queries.length; i < l; i++ ) {
    temp = queries[i].split('=');
    params[temp[0]] = temp[1];
  }

  return params;
};

/**
 *  ParseMaster parses the master manifest and creates a murphy stream for each rendition and starts each rendition at the same time.


 */

const parseMaster = function(request, response, body) {
  var result = body.toString();
  var lines = result.split('\n');
  var fullurl = request.query.url;
  var uriIndex;
  var i;
  var baseurl;
  var renditions = [];
  var rebuiltResult = '';
  var currentRendition;
  var currentPath;
  var eventType;
  var indexOfLastSlash;
  var manifestUrl;
  var line;
  var indexOfIp;
  var strm;

  if (request.query.event) {
    eventType = request.query.event;
  } else {
    eventType = 'live';
  }
  for (i = 0; i < lines.length; i++) {
    if (lines[i].indexOf('EXT-X-MEDIA') > -1) {
      if (lines[i].indexOf('TYPE=AUDIO') > -1 ||
        lines[i].indexOf('TYPE=SUBTITLES') > -1) {
        uriIndex = lines[i].indexOf('URI=');
        if (uriIndex > -1) {
          if (fullurl) {
            line = trimCharacters(lines[i].substr(uriIndex + 5), ['\'', '/', '.']).replace(/['"]+/g, '').replace(/(\r)/gm,"");
            indexOfLastSlash = fullurl.lastIndexOf('/');
            baseurl = fullurl.slice(0, indexOfLastSlash) + '/';
            if (baseurl.indexOf('http') > -1) {
              manifestUrl = `http://${request.headers.host}/${eventType}?url=${trimCharacters(line, ['.', '/'])}`;
            } else {
              manifestUrl = `http://${request.headers.host}/${eventType}?url=${baseurl + trimCharacters(line, ['.', '/'])}`;
            }
            renditions.push(manifestUrl);
            lines[i] = lines[i].replace(line, manifestUrl);
          } else {
            line=trimCharacters(lines[i].substr(uriIndex+5), ['\'', '/', '.']).replace(/['"]+/g, '');
            renditions.push(line);
          }
        }
      }
    }
    else if (lines[i].indexOf('EXT') > -1) {
      //continue;
    }
    else if (lines[i].indexOf('.m3u8') > -1) {
      if (fullurl) {
        indexOfLastSlash = fullurl.lastIndexOf('/');
        indexOfIp = fullurl.indexOf('master');
        baseurl = fullurl.slice(0, indexOfLastSlash) + '/';
        if (baseurl.indexOf('http') > -1) {
          manifestUrl = `http://${request.headers.host}/${eventType}?url=${trimCharacters(lines[i], ['.', '/'])}`;
        } else {
          manifestUrl = `http://${request.headers.host}/${eventType}?url=${baseurl + trimCharacters(lines[i], ['.', '/'])}`;
        }
        debuglog('manifestUrl: ' + manifestUrl);
        renditions.push(manifestUrl);
        lines[i] = manifestUrl;
      } else {
        renditions.push(trimCharacters(lines[i], ['.','/']));
      }
    }
    rebuiltResult = rebuiltResult + lines[i] + '\n';
  }

  for (i = 0; i < renditions.length; i++) {
    if (request.query.resetStream == 1) {
      resetLiveStream(renditions[i]);
    }

    //Ensure stream starts simultaneously with other renditions
    currentRendition = renditions[i];
    var urlarr = currentRendition.split('?');
    currentPath = urlarr[0];
    if (!fullurl && urlarr[1]) {
      let currentQuery = parseQueryString(urlarr[1]);
      strm = extend(getStream(currentPath), currentQuery);
      console.log('start rendition stream: ' + currentPath + ' start: ' + strm.start);
      strm = extend(getStream(renditions[i]), currentQuery);
      console.log('start rendition stream: ' + renditions[i] + ' start: ' + strm.start);
    }
    else {
      console.log('start rendition stream: ' + renditions[i]);
      strm = getStream(renditions[i]);
      console.log('start rendition stream: ' + renditions[i] + ' start: ' + strm.start);
    }

    if (request.query.stopStream == 1) {
      stopLiveStream(renditions[i]);
    }
  }

  if (request.query.resetStream == 2) {
    resetAllStreams();
  }
  if (request.query.stopStream == 2) {
    stopAllStreams();
  }


  response.setHeader('Content-type', 'application/x-mpegURL');
  response.charset = 'UTF-8';
  response.write(rebuiltResult);
  response.status(200);
  response.end();
};

/**
   Master function takes in a source and determines whether its an external or a local source.
 */
const master = function(request, response) {
  var renditions = [],
    result,
    rebuiltResult = '',
    lines,
    i,
    uriIndex,
    line,
    currentRendition,
    currentPath,
    currentQuery,
    urlarr,
    strm,
    fullurl,
    eventType,
    baseurl;

  fullurl = request.query.url;

  if (fullurl) {

    var req = fullurl.indexOf('https') > -1 ? https : http;

    req.get(fullurl, res => {
      res.setEncoding('utf8');
      var body = '';

      res.on('data', data => {
        body += data;
      });
      res.on('end', () => {
        body = body.toString();
        parseMaster(request, response, body);
      });
    });
  } else {
    fs.readFile(path.join(__dirname, 'master', request.path), function (error, data) {
      if (error) {
        return response.send(404, error);
      }
      parseMaster(request, response, data);
    });
  }
};

/**
 * Simulate a continuously appending live playlist. New segments are
 * added to the manifest at a fixed rate and no manifest entries are
 * ever removed.
 */

const eventFunction = function(request, response) {
  stream(request, response, 'event');
};

/**
   Redirect is used to serve out the external files stored in the redirect array.
 */


const redirectFunction = function(request, response) {
  var redirectKey;
  var indexOfRedirectKey;
  event = extend(getStream('redirect' + request.path), request.query);
  redirectKey = 'redirect' + request.path;
  debuglog(redirectKey + ' - ' + redirect[redirectKey]);
  if (processErrors(request, response, event) == true) {
    console.log('errors processed tsNotFound=' + event.tsNotFound);
    return response;
  }
  response.writeHead(301,
    {Location: redirect[redirectKey]}
  );
  response.end();
};

/**
   dataRequest serves out the local files from data directory.
 */

const dataRequest = function(request, response) {
  var pathname;
  event = extend(getStream('data' + request.path), request.query);

  //Filter out url variables
  if (request.originalUrl.toString().indexOf('?')>-1) {
    pathname = request.originalUrl.toString().slice(0, request.originalUrl.toString().indexOf('?'));
  }
  else {
    pathname = request.originalUrl.toString();
  }
  if (processErrors(request, response, event) == true) {
    console.log('errors processed tsNotFound=' + event.tsNotFound);
    return response;
  }
  debuglog(path.join(__dirname, 'data', request.path));

  var fileStream = fs.createReadStream(path.join(__dirname, pathname));
  fileStream.on('open', function () {
    fileStream.pipe(response);
  });
};

/**
   processErrors simultes the tsNotFound and manifestnotfound errors and allows to reset or stop the streams.

 */


const processErrors = function(request, response, event) {
  if (event.tsNotFound > 0 && request.path.indexOf('.ts') > -1) {
    event.tsNotFound--;
    console.log('send ts 404');
    response.status(404).send('not found');
    return true;
  }
  if (event.manifestnotfound>0 && request.path.indexOf('.m3u8') > -1) {
    event.manifestnotfound--;
    console.log('send manifest 404');
    response.status(404).send('not found');
    return true;
  }
  if (event.resetStream > 0) {
    //1 - Reset just this stream
    if (event.resetStream === 1) {
      resetLiveStream('live' + request.path);
    }
    //2 - Reset all streams
    if (event.resetStream === 2) {
      resetAllStreams();
    }
  }
  if (event.stopStream > 0) {
    //1 - Stop just this stream

    if (event.stopStream === 1) {
      stopLiveStream('live' + request.path);
    }
    //2 - Stop all streams
    if (event.stopStream === 2) {
      stopAllStreams();
    }
  }
  return false;
};

/**
 * Injects error into an existing stream.
 */
const injectError = function(request, response) {
  var streamname='live' + request.path;
  event = extend(getStream(streamname), request.query);
  console.log('tsNotFound in ' + streamname + ' = ' + event.tsNotFound);
  return response.send(200, 'injected into ' + streamname);
};

const trimCharacters = function(str, char) {
  var i, j, found;
  for(i = 0; i < str.length; i++) {
    found = false;
    for (j = 0; j < char.length; j++) {
      if (str.charAt(i) == char[j]) {
        found = true;
      }
    }
    if (found == false) {
      break;
    }
  }
  return str.slice(i);
};

/**
   getManifestObjects gets the headers and resources and initializes the playlist if it hasn't been initialized and passes the playlist to extractResourceWindow

 */

const getManifestObjects = function (request, response, body, streamtype, fullurl) {
  var baseurl, renditionName, manifestHeader, manifestResources, tsstreampath, result, playlist, duration;
  if (fullurl) {
    var indexOfLastSlash = fullurl.lastIndexOf('/');
    baseurl = fullurl.slice(0, indexOfLastSlash) + '/';
  }
  const streampath = baseurl ? fullurl : streamtype + request.path;

  console.log('streampath: ' + streampath);
  event = extend(getStream(streampath), request.query);
  renditionName = streampath.match(/.*\/(.+).m3u8/i)[1];
  console.log('renditionName: ' + streampath);
  if (!event.sequenceOffsets[renditionName]) {
    event.sequenceOffsets[renditionName] = Math.floor(Math.random() * 50);
  }
  duration = Date.now() - event.start;
  if (manifest[streampath] === undefined) {

    playlist = body.toString().replace(/(\r)/gm,""); //old data
    console.log('playlist: ' + playlist);
    manifestHeader = getHeaderObjects(playlist);
    manifestResources = getResources(playlist, request, event, baseurl);
    manifest[streampath] = {
      header: manifestHeader,
      resources: manifestResources
    };
  }

  if (event.resetStream === 1) {
    event.resetStream = 0;
    resetLiveStream(streampath);
  }
  if (event.resetStream === 2) {
    event.resetStream = 0;
    resetAllStreams();
  }

  if (event.stopStream === 1) {
    event.resetStream = 0;
    stopLiveStream(streampath);
  }

  if (event.stopStream === 2) {
    event.resetStream = 0;
    stopAllStreams();
  }

  if (event.tsNotFound > 0) {
    //Pick a future .ts file to inject 404
    tsstreampath = manifest[streampath].resources[event.lastStartPosition + event.window + 1].tsfile;
    tsstreampath = trimCharacters(tsstreampath, ['/', '.']);
    console.log('Target for 404: ' + tsstreampath);
    stream = getStream(tsstreampath);
    //Pass error value to the ts stream
    if (stream.tsNotFound) {
      stream.tsNotFound++;
    }
    else {
      stream.tsNotFound = 1;
    }
    event.tsNotFound--;
  }
  if (event.manifestnotfound > 0) {
    if (processErrors(request, response, event) == true) {
      console.log('errors processed manifestnotfound=' + event.manifestnotfound);
      return response;
    }
  }

  event.rate = event.rate ? event.rate : manifestHeader.TargetDuration.value;

  result = extractResourceWindow(manifest[streampath], duration, event, streamtype);

  response.setHeader('Content-type', 'application/x-mpegURL');
  response.charset = 'UTF-8';
  response.write(result.join('\n'));
  response.end();
};

/**
   stream checks whether the source is an external or local source and calls getManifestObjects and passes the extracted url as well as the text of the renditions.

 */

const stream = function(request, response, streamtype) {
  var duration, event, playlist, result, renditionName, manifestHeader,
    manifestResources, streampath, tsstreampath, stream, fullurl, baseurl;

  streamtype = streamtype || 'live';
  fullurl = request.query.url;

  debuglog('fullurl: ' + fullurl);

  if (fullurl) {

    var req = fullurl.indexOf('https') > -1 ? https : http;
    req.get(fullurl, res => {
      res.setEncoding('utf8');
      var body = '';

      res.on('data', data => {
        body += data;
      });
      res.on('end', () => {
        body = body.toString();
        getManifestObjects(request, response, body, streamtype, fullurl);
      });
    });
  } else {
    fs.readFile(path.join(__dirname, 'data', request.path), function (error, data) {
      if (error) {
        return response.send(404, error);
      }
      getManifestObjects(request, response, data, streamtype, fullurl);
    });
  }
};

/**
 * Simulate a sliding window live playlist. New segments are added and
 * old segments are removed at a fixed rate.
 */
const live = function(request, response) {
  stream(request, response, 'live');
};

module.exports = {
  eventFunction: eventFunction,
  live: live,
  dataRequest: dataRequest,
  injectError: injectError,
  redirectFunction: redirectFunction,
  master: master,
  ui: ui,
  streams: streams,
  getStream: getStream,
  getHeaderObjects: getHeaderObjects,
  getResources: getResources,
  extractResourceWindow: extractResourceWindow,
  processErrors: processErrors,
  debug: debug
};
