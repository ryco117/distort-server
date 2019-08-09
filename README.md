# DistoRt Homeserver
([site](https://ryco117.github.io/distort-server/))

### About
A reference implementation homeserver for the research anonymity protocol [DistoRt](https://distortapp.org) (designed by [JS Légaré](https://github.com/init-js)), with message broadcasting performed over [IPFS](https://ipfs.io). 
The homeserver is created with nodejs and stores its data to a MongoDB database. It can be interacted with remotely through REST API calls. 
A privately managed IPFS node must be exposed to the homeserver for pushing and receiving messages.

### Build
##### Docker Build
Run `make && docker-compose up` to launch containers for a private Mongo database, contained IPFS node, and the distort homeserver (exposing the configured port; default is 6945).

##### Host Build
Can be easily built with `make && npm install` then launched with `npm start`. In this instance you are responsible for having a private Mongo database and IPFS node that the homeserver can access.
This will require manual configuration of the `config.json` file, documentation for which can be found [here](https://ryco117.github.io/distort-server/docs/#configuration).

### Technical Docs
More detailed documentation overviewing the servers function and the REST API can be found [here](https://ryco117.github.io/distort-server/docs).

### Additional Comments
* It is highly recommended to join anonymity group `パン` until there are enough large-scale anonymity groups that safe alternatives exist (which admittedly is a bit of a chicken-and-the-egg situation)
* While the REST API calls offer no end-to-end encryption of their own between the client and server, it is highly recommended to create a reverse proxy in front of the server, using HTTPS with a 
signed certificate. The certificates can be signed either by a recognized Certificate Authroity (eg., [Lets Encrypt](https://letsencrypt.org/)) or be self-signed. If self-signing, ensure that the client trusts the certificate.
