# murphy
Proactively making Murphy's law a reality...

## How to use
Start the server using 'npm start'
Run the unit tests using 'npm test'

## Live stream error simulator
Murphy, the live stream error simulator, will take an HLS VOD playlist and simulate a 
shifting livestream resource window.  

In the path to the manifest with `live/`. If you wanted to try a live version of `http://localhost:9191/data/apple/gear4/prog_index.m3u8`,
for instance, you would request `http://localhost:9191/live/apple/gear4/prog_index.m3u8`

The Live Stream simulator also takes into account multiple renditions. To access the master playlist, the following master file points to four 
live simulated renditions of apple bipbop. `http://localhost:9191/master/apple/bipbopall.m3u8`

Currently, it is possible to inject 404 errors into the live stream by opening another browser instance and replacing the 'test' path of the 
rendition with 'error' and adding a variable to the link.  At the moment, tsnotfound and manifestnotfound are the two types of variables that can
be added with the value being the number of 404 errors that will be injected. 
 
For example, the following link will inject a 404 error on one ts file associated with the specified rendition in the link:
`http://localhost:9191/error/apple/gear4/prog_index.m3u8?tsnotfound=1`

If you would like to see a barebones UI that shows which streams are currently being simulated, go to the following link: 
`http://localhost:9191/ui/index.html`

Note: At default, no streams are simulated when the server is started.  A simulation will begin as soon as there is a request for one.

## To Do:
1. Add additional types of error injections into the Live Stream Simulator


Note: This design is partially based on earlier work by David LaPalomento

