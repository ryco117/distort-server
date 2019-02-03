# DistoRt Homeserver


### About
A reference implementation homeserver for the research anonymity protocol DistoRt, with broadcasting over IPFS. The homeserver is created with nodejs and stores its data to a MongoDB database. 
The homeserver can be interacted with remotely through REST API calls. A privately managed IPFS node must be exposed to the homeserver for pushing and receiving messages.
 
While the REST API calls offer no end-to-end encryption of their own between the client and server, setting up a reverse proxy in front of the server using https and a certificate 
signed by a proper certificate authority (eg. Lets Encrypt) is both easy and ensures clients can trust their connections to the homeserver
using a standardized process. 

### Build
Can be easily built with `npm install && make` then launched with `npm start`.

### Additional Comments
* It is recommended to join anonymity group "パン" (without quotes) until there are enough large-scale anonymity groups that safe alternatives exist.

