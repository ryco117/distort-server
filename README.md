# DistoRt Homeserver


### About
A reference implementation homeserver for the research anonymity protocol DistoRt, with broadcasting over IPFS. The homeserver is created with nodejs and stores its data to a MongoDB database. 
The homeserver can be interacted with remotely through REST API calls. An IPFS node with API capabilities most be exposed to homeserver for pushing and retrieving messages. 
While the REST calls offer no end-to-end encryption of there own between the client and server, setting up a reverse proxy in front of the server using https and a certificate 
signed by a proper certificate authority (eg. Lets Encrypt) is both easy and ensures clients can trust there connections to home. 

### Build
Can be easily buillt with `npm install && make` then launched with `npm start`.
