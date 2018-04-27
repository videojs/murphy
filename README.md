# murphy
Proactively making Murphy's law a reality...

```sh
npm install @videojs/murphy
```

## How to use
Start the server using 'npm start'
Run the unit tests using 'npm test'

## Live stream error simulator
Murphy, the live stream error simulator, will take an HLS VOD playlist and simulate a
shifting livestream resource window.  

## Online manifest
For external master url use the master path and the url query parameter like this
 `http://localhost:9191/master?url=https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8`.

You can also add an optional event parameter which can point to event or live. The default one is live.
 The live endpoint stream is a sliding window live stream and the event endpoint stream is appending window stream.
`http://localhost:9191/master?event=event&url=https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8`
It takes an optional argument of event at the end

For an external sliding window single rendition stream point to the live path
`http://localhost:9191/live?url=https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/v2/prog_index.m3u8`

For an external appending window single rendition stream point to to the event path
`http://localhost:9191/event?url=https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/v2/prog_index.m3u8`


## Local Manifest
In the path to the manifest with `live/`. If you wanted to try a live version of `http://localhost:9191/data/maat/bunny/video/video.m3u8`,
for instance, you would request `http://localhost:9191/data/maat/bunny/video/video.m3u8`

The Live Stream simulator also takes into account multiple renditions. To access the master playlist, the following master file points to four
live simulated renditions of maat planet. `http://localhost:9191/master/maat/planet.m3u8`

Currently, it is possible to inject 404 errors into the live stream by opening another browser instance and replacing the 'test' path of the
rendition with 'error' and adding a variable to the link.  At the moment, tsnotfound and manifestnotfound are the two types of variables that can
be added with the value being the number of 404 errors that will be injected.

For example, the following link will inject a 404 error on one ts file associated with the specified rendition in the link:
`http://localhost:9191/error/maat/bunny/video/video.m3u8?tsnotfound=1`

In order to reset a livestream, use the resetStream variable.  If this variable is set to 1, it will restart the target stream.
If the target stream is a master manifest, it will reset each rendition in the manifest.  If this variable is set to 2,
all streams will be restarted.

For example, this following link will restart all renditions in the master manifest:
`http://localhost:9191/master/maat/planet.m3u8?resetStream=1`

In order to stop all streams, use the stopStream variable. If this variable is set to 1, it will stop the target stream.
If the target stream is a master manifest, it will stop each rendition in the manifest.  If this variable is set to 2,
all streams will be stopped.  You can start the stream normally by requesting the manifest again in the future.

For example, this following link will stop all renditions in the master manifest:
`http://localhost:9191/master/maat/planet.m3u8?stopStream=1`

If you would like to see a barebones UI that shows which streams are currently being simulated, go to the following link:
`http://localhost:9191/ui/index.html`

Note: At default, no streams are simulated when the server is started.  A simulation will begin as soon as there is a request for one.

## To Do:
1. Add additional types of error injections into the Live Stream Simulator
2. Cleanup injection code


Note: This design is partially based on earlier work by David LaPalomento
