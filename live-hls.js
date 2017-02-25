/**
 * Routes that help simulate live HLS playlists.
 */
var fs = require('fs');
var extend = require('lodash').extend;
var path = require('path');
var url = require('url');
var express = require('express');
var streams = {};
var debug = 0;
var defaults = {
  // seconds per resource
  rate: 10,
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
  tsnotfound: 0,
  manifestnotfound: 0,
  resetStream: 0,
  stopStream: 0
};
var manifest = [];
var redirect = [];
var redirectCount = 0;
var event;
var live;
var filterPlaylist;
var getStream;
var resetLiveStream;
var resetAllStreams;
var stopLiveStream;
var stopAllStreams;
var dataRequest;
var injectError;
var getHeaderObjects;
var getResources;
var getInitialValue;
var cleanup;
var extractHeader;
var extractResourceWindow;
var createManifest;
var master;
var processErrors;
var trimCharacters;
var ui;

debuglog = function(str) {
  if (debug == 1) {
    console.log(str);
  }
};
getHeaderObjects = function(fileContent) {
  var lines = fileContent.split('\n'),
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

    if(lines[i].toLowerCase().indexOf('.aac') > -1) {
      break;
    }

    if(lines[i].toLowerCase().indexOf('.webvtt') > -1) {
      break;
    }

    if (lines[i].toLowerCase().indexOf('.ts')>-1) {
      //break out because we're no longer in header
      break;
    }
    if (lines[i].indexOf('#EXTINF')>-1) {
      //break out because we're no longer in header
      break;
    }
    if (indexOfColon>0) {
      header.Extra.push(lines[i]);
    }
  }
  return header;
};

getSegmentHeader = function(lines, index) {
  var i,
    header='',
    byterange='',
    segment;
  for(i=(index-1);i>0;i--) {
    //Search backwards from index to get all header lines
    if (lines[i].indexOf('EXTINF')>-1) {
      header=lines[i];
    } else if (lines[i].indexOf('EXT-X-BYTERANGE') > -1) {
      byterange=lines[i];
    } else if (lines[i].indexOf('EXT-X-CUE') > -1) {
      header = lines[i] + '\n' + header;
    } else if(lines[i].indexOf('EXT-X-DISCONTINUITY') > -1 && lines[i].indexOf('EXT-X-DISCONTINUITY-SEQUENCE') === -1) {
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
  return segment;
};

getResources = function(fileContent, request) {
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
    if ((lines[i].toLowerCase().indexOf('.ts') > 0) ||
        (lines[i].toLowerCase().indexOf('.aac') > 0) ||
        (lines[i].toLowerCase().indexOf('.webvtt') > 0)) {
      segment=getSegmentHeader(lines, i);

      file = lines[i];
      if (file.indexOf('http')>-1) {
        arr = file.split('.');
        if (arr.length > 1) {
          ext = arr[arr.length - 1];
        }
        reqpathmod = request.path.substr(0, request.path.lastIndexOf('/') + 1);
        debuglog(reqpathmod);
        debuglog('request path: ' + request.path);
        redirectFile = 'redirect' + reqpathmod + redirectCount + '.' + ext;
        redirectCount++;
        redirect[redirectFile] = file;
        debuglog('save redirect: ' + redirectFile + ' - ' + file);
        for (j = 0; j < reqpathmod.split('/').length - 1; j++) {
          prepend_redirectFile = prepend_redirectFile + '../';
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

getInitialValue = function(allLines) {
  var i;
  for (i = 0;i<allLines.length;i++) {
    if (allLines[i].indexOf('#EXTINF')>-1) {
      return i;
    }
  }
};

cleanup = function(fileContent) {
  var lines = fileContent.split('\n');
  for (var i = 0;i<lines.length;i++) {
    if (lines[i].indexOf('TOTAL-DURATION') > -1) {
      debuglog('delete line: ' + lines[i]);
      lines.splice(i, 1);
    }
    if (lines[i].indexOf('#EXT-X-ENDLIST') === 0)
    {
      debuglog('delete line: ' + lines[i]);
      lines.splice(i, 1);
    }
    if (lines[i] == '') {
      debuglog('delete line: ' + lines[i]);
      lines.splice(i, 1);
    }
  }
  return lines.join('\n');
};

extractHeader = function(header, event) {
  var lines = [];
  lines.push(header.Firstline);
  if (header.PlaylistType) {
    lines.push(header.PlaylistType.tag + ':event'); //parameterize this later?
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

extractResourceWindow = function(mfest,duration,event) {
  var startposition;
  var endposition;
  var overflow = 0;
  var header = mfest.header;
  var resource = mfest.resources;
  var lines;
  var i;
  startposition = Math.floor((duration*0.001)/event.rate);
  debuglog('start before mod ' + startposition);
  debuglog('event start '+event.start);
  event.discontinuity=Math.floor(startposition/resource.length);
  event.dropped=startposition;
  if (event.dropped<0) {
    event.dropped=0;
  }
  startposition = startposition%resource.length;

  //startposition = startposition - (startposition % options.step);
  if (event.lastStartPosition<startposition) {
    debuglog('dropped: ' + event.dropped);
  }
  endposition = startposition + event.window-1;

  if (endposition >= resource.length) {
    debuglog('endposition before mod: ' + endposition);
    overflow = endposition-(resource.length-1);

    endposition = resource.length-1;
  }
  debuglog('startposition: ' + startposition);
  debuglog('endposition: ' + endposition);
  debuglog('overflow: ' + overflow);
  debuglog('resource length: ' + resource.length);
  debuglog('rate: ' + event.rate);
  lines=extractHeader(header, event);
  for(i = startposition;i <= endposition;i++) {
    if (resource[i].header) {
      lines.push(resource[i].header);
    }
    if (resource[i].byterange) {
      lines.push(resource[i].byterange);
    }
    if (resource[i].tsfile) {
      lines.push(resource[i].tsfile);
    }
  }
  if (overflow>0) {
    lines.push('#EXT-X-DISCONTINUITY');
    for(i = 0;i<overflow;i++) {
      if (resource[i].header) {
        lines.push(resource[i].header);
      }
      if (resource[i].byterange) {
        lines.push(resource[i].byterange);
      }
      if (resource[i].tsfile) {
        lines.push(resource[i].tsfile);
      }
    }
  }
  event.lastStartPosition = startposition;
  return lines;
};

/**
 * creates simulated livestream m3u8 manifest file content from an existing manifest object
 * @param mfest {Object} Manifest Object
 * @param duration {number} the amount of time that has passed since the
 * stream began
 * @param event {object} a hash of parameters that affect the timing
 * of the stream
 * @return {string} the lines of the playlist that would be available
 * at the specified time
 */
createManifest = function(mfest, duration, event) {
  return extractResourceWindow(mfest, duration, event);
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
filterPlaylist = function(playlist, time, options) {
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

ui = function(request, response) {
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
          button.replace('errorcode', 'tsnotfound').replace('errortext','ts404') +
          button.replace('errorcode', 'manifestnotfound').replace('errortext','manifest404') + '</tr>\n';
      }
      if (key.indexOf('.ts') > -1 ||
          key.indexOf('.aac') > -1 ||
          key.indexOf('.webvtt') > -1) {
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

getStream = function(name) {
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

resetLiveStream = function(name) {
  console.log('resetting stream:', name);
  delete streams[name];
  return getStream(name);
};

resetAllStreams = function() {
  var streamName;
  for(streamName in streams) {
    resetLiveStream(streamName);
  }
};

stopLiveStream = function(name) {
  console.log('stop stream:', name);
  delete streams[name];
};

stopAllStreams = function() {
  var streamName;
  for(streamName in streams) {
    stopLiveStream(streamName);
  }
};

var parseQueryString = function( queryString ) {
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

//Start each rendition at the same time
master = function(request, response) {
  var renditions = [],
    result,
    lines,
    i,
    uriIndex,
    line,
    currentRendition,
    currentPath,
    currentQuery,
    urlarr,
    strm;
  console.log('fetch master: ' + request.path);
  fs.readFile(path.join(__dirname, 'master', request.path), function(error, data) {
    if (error) {
      return response.send(404, error);
    }

    result = data.toString();
    lines = result.split('\n');

    for(i = 0;i<lines.length;i++) {
      if (lines[i].indexOf('EXT-X-MEDIA') > -1) {
        if (lines[i].indexOf('TYPE=AUDIO') > -1 ||
            lines[i].indexOf('TYPE=SUBTITLES') > -1) {
          uriIndex = lines[i].indexOf('URI=');
          if (uriIndex > -1) {
            line=trimCharacters(lines[i].substr(uriIndex+5), ['\'', '/', '.']).replace(/['"]+/g, '');
            renditions.push(line);
          }
        }
      }
      else if (lines[i].indexOf('EXT') > -1) {
        continue;
      }
      else if (lines[i].indexOf('.m3u8')>-1) {
        renditions.push(trimCharacters(lines[i], ['.','/']));
      }
    }

    for(i = 0;i<renditions.length;i++) {
      if (request.query.resetStream==1) {
        resetLiveStream(renditions[i]);
      }

      //Ensure stream starts simultaneously with other renditions
      currentRendition=renditions[i];
      urlarr=currentRendition.split('?');
      currentPath=urlarr[0];
      if (urlarr[1]) {
        currentQuery=parseQueryString(urlarr[1]);
        strm=extend(getStream(currentPath), currentQuery);
        console.log('start rendition stream: ' + currentPath + ' start: ' + strm.start);
        strm=extend(getStream(renditions[i]), currentQuery);
        console.log('start rendition stream: ' + renditions[i] + ' start: ' + strm.start);

      }
      else {
        console.log('start rendition stream: ' + renditions[i]);
        strm=getStream(renditions[i]);
        console.log('start rendition stream: ' + renditions[i] + ' start: ' + strm.start);
      }

      if (request.query.stopStream==1) {
        stopLiveStream(renditions[i]);
      }
    }

    if (request.query.resetStream==2) {
      resetAllStreams();
    }
    if (request.query.stopStream==2) {
      stopAllStreams();
    }


    response.setHeader('Content-type', 'application/x-mpegURL');
    response.charset = 'UTF-8';
    response.write(result);
    response.status(200);
    response.end();
  });
  return this;
};

/**
 * Simulate a continuously appending live playlist. New segments are
 * added to the manifest at a fixed rate and no manifest entries are
 * ever removed.
 */

event = function(request, response) {
  fs.readFile(path.join(__dirname, 'data', request.path), function(error, data) {
    var event, playlist, result;
    if (error) {
      return response.send(404, error);
    }

    event = extend(getStream('event/' + request.path), request.params);

    playlist = data.toString();
    result = filterPlaylist(playlist,
      Date.now() - event.start,
      event);

    if (playlist.length === result.length) {
      resetLiveStream('event/' + request.path);
    }

    response.setHeader('Content-type', 'application/x-mpegURL');
    response.charset = 'UTF-8';
    response.write(result);
    response.status(200);
    response.end();
  });
};

redirect = function(request, response) {
  var redirectKey;
  event = extend(getStream('redirect' + request.path), request.query);
  redirectKey = 'redirect' + request.path;
  debuglog(redirectKey + ' - ' + redirect[redirectKey]);
  if (processErrors(request, response, event) == true) {
    console.log('errors processed tsnotfound=' + event.tsnotfound);
    return response;
  }
  //var fileStream = fs.createReadStream(redirect[redirectKey]);
  response.writeHead(301,
    {Location: redirect[redirectKey]}
  );
  response.end();
};

dataRequest = function(request, response) {
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
    console.log('errors processed tsnotfound=' + event.tsnotfound);
    return response;
  }
  debuglog(path.join(__dirname, 'data', request.path));

  var fileStream = fs.createReadStream(path.join(__dirname, pathname));
  fileStream.on('open', function () {
    fileStream.pipe(response);
  });
};

processErrors = function(request, response, event) {
  if (event.tsnotfound>0 && request.path.indexOf('.ts') > -1) {
    event.tsnotfound--;
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
  if (event.resetStream>0) {
    //1 - Reset just this stream
    if (event.resetStream==1) {
      resetLiveStream('live' + request.path);
    }
    //2 - Reset all streams
    if (event.resetStream==2) {
      resetAllStreams();
    }
  }
  if (event.stopStream>0) {
    //1 - Stop just this stream

    if (event.stopStream==1) {
      stopLiveStream('live' + request.path);
    }
    //2 - Stop all streams
    if (event.stopStream==2) {
      stopAllStreams();
    }
  }
  return false;
};

/**
 * Inject error
 */
injectError = function(request, response) {
  var streamname='live' + request.path;
  event = extend(getStream(streamname), request.query);
  console.log('tsnotfound in ' + streamname + ' = ' + event.tsnotfound);
  return response.send(200, 'injected into ' + streamname);
};

trimCharacters = function(str, char) {
  var i, j, found;
  for(i = 0;i<str.length;i++) {
    found = false;
    for (j = 0;j<char.length;j++) {
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
 * Simulate a sliding window live playlist. New segments are added and
 * old segments are removed at a fixed rate.
 */
live = function(request, response) {
  var duration, event, playlist, result, renditionName, manifestHeader,
    manifestResources, streampath, tsstreampath, stream;


  fs.readFile(path.join(__dirname, 'data', request.path), function (error, data) {
    if (error) {
      return response.send(404, error);
    }

    streampath = 'live' + request.path;
    event = extend(getStream(streampath), request.query);
    renditionName = request.path.match(/.*\/(.+).m3u8/i)[1];
    console.log('renditionName: ' + streampath);
    if (!event.sequenceOffsets[renditionName]) {
      event.sequenceOffsets[renditionName] = Math.floor(Math.random() * 50);
    }
    duration = Date.now() - event.start;
    if (manifest[streampath] == undefined) {

      playlist = data.toString();
      manifestHeader = getHeaderObjects(playlist);
      manifestResources = getResources(playlist, request);
      manifest[streampath] =
      {
        header: manifestHeader,
        resources: manifestResources
      };
    }

    if (event.resetStream==1) {
      event.resetStream = 0;
      resetLiveStream(streampath);
    }
    if (event.resetStream==2) {
      event.resetStream = 0;
      resetAllStreams();
    }

    if (event.stopStream==1) {
      event.resetStream = 0;
      stopLiveStream(streampath);
    }

    if (event.stopStream==2) {
      event.resetStream = 0;
      stopAllStreams();
    }

    if (event.tsnotfound>0) {
      //Pick a future .ts file to inject 404
      tsstreampath = manifest[streampath].resources[event.lastStartPosition + event.window + 1].tsfile;
      tsstreampath = trimCharacters(tsstreampath, ['/','.']);
      console.log('Target for 404: ' + tsstreampath);
      stream = getStream(tsstreampath);
      //Pass error value to the ts stream
      if (stream.tsnotfound) {
        stream.tsnotfound++;
      }
      else {
        stream.tsnotfound = 1;
      }
      event.tsnotfound--;
    }
    if (event.manifestnotfound>0) {
      if (processErrors(request, response, event) == true) {
        console.log('errors processed manifestnotfound=' + event.manifestnotfound);
        return response;
      }
    }

    result=createManifest(manifest[streampath], duration, event);

    response.setHeader('Content-type', 'application/x-mpegURL');
    response.charset = 'UTF-8';
    response.write(result.join('\n'));
    response.end();
  });
};

module.exports = {
  event: event,
  live: live,
  dataRequest: dataRequest,
  injectError: injectError,
  redirect: redirect,
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
