/**
 * Created by mroca on 2/26/16.
 */
//var QUnit = require('../node_modules/qunit');
var test = require('tape');
var livehls = require('../live-hls.js');
var fs = require('fs');
var httpMocks = require('node-mocks-http');

test('getHeaderObjects: Get header file data into object', function(t) {
  var manifestHeader;
  fs.readFile('./data/renditions/samples/two/sp_manifest2.m3u8', function (error, data) {
    manifestHeader = livehls.getHeaderObjects(data.toString());
    t.equal(manifestHeader.PlaylistType.tag, '#EXT-X-PLAYLIST-TYPE', 'PlaylistType tag matches');
    t.equal(manifestHeader.PlaylistType.value, '', 'PlaylistType value matches');
    t.equal(manifestHeader.MediaSequence.tag, '#EXT-X-MEDIA-SEQUENCE', 'MediaSequence tag matches');
    t.equal(manifestHeader.MediaSequence.value, '2', 'MediaSequence value matches');
    t.equal(manifestHeader.TargetDuration.tag, '#EXT-X-TARGETDURATION', 'MediaSequence tag matches');
    t.equal(manifestHeader.TargetDuration.value, '10', 'MediaSequence value matches');
  });
  t.end();
});

test('getResources: Get resource file data into object', function(t) {
  var resourceObject, i;
  var request = {path: ''};
  fs.readFile('./data/renditions/samples/three/sp_manifest3.m3u8', function (error, data) {
    if (error) {
      throw error;
    }
    resourceObject = livehls.getResources(data.toString(), request);
    for(i=0;i<resourceObject.length;i++) {
      t.equal(resourceObject[i].tsfile, '/data/renditions/samples/three/segment' + i + '_110_av.ts?sd=10',
        'resource file at index ' + i);
      t.equal(resourceObject[i].header, '#EXTINF:10,',
        'resource header at index ' + i);
    }
  });
  t.end();
});

test('getResources: Get resource file data into object', function(t) {
  var resourceObject, i;
  var request = {path: ''};
  fs.readFile('./data/maat/gear0/prog_index.m3u8', function (error, data) {
    if (error) {
      throw error;
    }
    resourceObject = livehls.getResources(data.toString(), request);
    for(i=0;i<10;i++) {
      t.equal(resourceObject[i].tsfile, '../../../data/maat/gear0/main.aac',
        'resource file at index ' + i);
      t.equal(resourceObject[i].byterange.substring('#EXT-X-BYTERANGE', 16),
        '#EXT-X-BYTERANGE', 'Segment contains byte range');
    }
  });
  t.end();
});

test('getResources: Get redirected resource file data', function(t) {
  var resourceObject, i;
  var request = {path: '/apple/gear4/prog_index.m3u8'};
  var expectedHeaders = [
    '#EXTINF:10, no desc',
    '#EXTINF:10, no desc',
    '#EXT-X-CUE-OUT:30\n#EXTINF:10, no desc',
    '#EXT-X-CUE-OUT-CONT:10/30\n#EXTINF:10, no desc',
    '#EXT-X-CUE-OUT-CONT:20/30\n#EXTINF:10, no desc',
    '#EXT-X-CUE-IN\n#EXTINF:10, no desc',
    '#EXTINF:10, no desc',
    '#EXTINF:10, no desc',
    '#EXTINF:10, no desc',
    '#EXTINF:10, no desc'
  ];
  fs.readFile('./data/apple/gear4/prog_index.m3u8', function (error, data) {
    if (error) {
      throw error;
    }
    resourceObject = livehls.getResources(data.toString(), request);
    //Limit the results to 10 resources
    for(i=0;i<10;i++) {
      t.equal(resourceObject[i].tsfile, '../../../redirect/apple/gear4/' + i + '.ts',
        'directed resource file at index ' + i);
      t.equal(resourceObject[i].header, expectedHeaders[i],
        'resource header at index ' + i);
    }
  });
  setTimeout(function() {
    t.end();
  }, 1000);
});

test('extractResourceWindow: Get live resource window', function(t) {
  var manifestheader, resourceObject, manifest, result, duration, event;
  var request = {path: '/apple/gear4/prog_index.m3u8'};
  fs.readFile('./data/maat/bunny/video/video.m3u8', function (error, data) {
    if (error) {
      throw error;
    }
    manifestheader = livehls.getHeaderObjects(data.toString());
    resourceObject = livehls.getResources(data.toString(), request);
    manifest= {
      header: manifestheader,
      resources: resourceObject
    };
    duration = 0;
    event = {
      // seconds per resource
      rate: 10,
      // number of ts files in the sliding window
      window: 5,
      // the number of ts files in each update
      step: 1,
      // the number of dropped media files
      dropped: 0,
      lastStartPosition: 0,
      tsnotfound: 0,
      manifestnotfound: 0
    };
    result=livehls.extractResourceWindow(manifest, duration, event, 'live');
    t.equal(result[8], manifest.resources[0].tsfile, 'Match start of resource');
    duration=10000; //10 seconds in the future
    result=livehls.extractResourceWindow(manifest, duration, event, 'live');
    t.equal(result[8], manifest.resources[1].tsfile,
      'Match start of resource after 10 second duration');
    duration=60000; //60 seconds in the future
    result=livehls.extractResourceWindow(manifest, duration, event, 'live');
    t.equal(result[8], manifest.resources[6].tsfile,
      'Match start of resource  after 60 second duration');
  });

  t.end();
});

test('Process 404 in ts file', function(t) {
  var request  = httpMocks.createRequest({
    method: 'GET',
    path: './tsfile.ts',
    url: 'http://localhost/tsfile.ts',
    params: {
      id: 42
    }
  });
  var response = httpMocks.createResponse();
  var event= {
    tsnotfound:1,
    manifestnotfound:0
  };

  livehls.processErrors(request, response, event);
  t.equal(response.statusCode, 404, 'Response returns a 404 status');
  t.end();
});

test('Process 404 in m3u8 file', function(t) {
  var request  = httpMocks.createRequest({
    method: 'GET',
    path: './file.m3u8',
    url: 'http://localhost/file.m3u8',
    params: {
      id: 42
    }
  });
  var response = httpMocks.createResponse();
  var event= {
    tsnotfound:0,
    manifestnotfound:1
  };

  livehls.processErrors(request, response, event);
  t.equal(response.statusCode, 404, 'Reponse returns a 404 status');
  t.end();
});
