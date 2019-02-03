# DistoRt Homeserver
([site](https://ryco117.github.io/distort-server/))

### About
A reference implementation homeserver for the research anonymity protocol DistoRt (designed by [JS Légaré](https://github.com/init-js)), with message broadcasting performed over IPFS. 
The homeserver is created with nodejs and stores its data to a MongoDB database. It can be interacted with remotely through REST API calls. 
A privately managed IPFS node must be exposed to the homeserver for pushing and receiving messages.
 
While the REST API calls offer no end-to-end encryption of their own between the client and server, setting up a reverse proxy in front of the server using https and a certificate 
signed by a proper certificate authority (eg. Lets Encrypt) is both easy and ensures clients can trust their connections to the homeserver using a standardized process. 

More detailed documentation can be found [here](https://ryco117.github.io/distort-server/docs).

### Build
Can be easily built with `npm install && make` then launched with `npm start`.

### Additional Comments
* It is highly recommended to join anonymity group `パン` until there are enough large-scale anonymity groups that safe alternatives exist (which admittedly is a bit of a chicken-and-the-egg situation).

