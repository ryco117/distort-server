# DistoRt Homeserver
([main page](https://ryco117.github.io/distort-server))

These technical docs are meant for homeserver administrators to be able to properly configure their server, as well as developers wishing to write DistoRt clients and homeservers

## Table of Contents
1. [Server Overview](#server-overview)
    1. [Configuration](#configuration)
    1. [Launch Actions](#launch-actions)
    1. [Runtime Actions](#runtime-actions)
        * [Handle API Requests](#handle-api-requests)
        * [Dequeue Messages](#dequeue-messages)
        * [Receive Messages](#receive-messages)
        * [Renew Certificates](#renew-certificates)
        * [Receive Certificates](#receive-certificates)
1. [REST API](#rest-api)
    1. [Response Codes](#response-codes)
    1. [Returned JSON Objects](#returned-json-objects)
    1. [Unauthenticated Requests](#unauthenticated-requests)
        * [/ipfs](#ipfs)
        * [/create-account](#create-account)
    1. [Authenticated Requests](#authenticated-requests)
        * [/groups](#groups)
        * [/groups/:group-name](#groups-name)
        * [/groups/:group-name/:index-start/\[:index-end\]](#groups-name-index)
        * [/account](#account)
        * [/peers](#peers)
        * [/signatures](#signatures)

## Server Overview
### Configuration
The server is configurable by the top-level JSON file `config.json`. It features several configurables:
* `debug`: boolean; print debug-level information to the console iff this key has a positive truthyness value
* `ipfsNode`: object; information on the IPFS node to use for IPFS API and as the node's identity
    * `address`: string; IP or domain address of the IPFS node to use
    * `bootstrap`: array of strings; A list of [IPFS multiaddrs](https://github.com/ipfs/go-ipfs-addr) to connect to at server start, 
    to help bootstrap connectivity between DistoRt peers
    * `port`: positive integer; API port of the IPFS node to use
* `mongoAddress`: string; the string to use to connect to the MongoDB to use. Eg., "mongodb://mongo:27017/distort"
* `port`: positive integer; the local port to open for REST API calls
* `protocolVersion`: string; the version string of the protocol this server will implement. Eg., "0.1.0"

### Launch Actions
1. Connect to the configured MongoDB to use for node storage. Retry every 5 seconds until successful connection
1. Attempt to successfully perform the following actions without failure. Retry every 5 seconds until completion without having to abort
    1. Connect to the configured IPFS node that will be used as the node's broadcasting identity and gateway
    1. [Force the connected IPFS node to verify pubsub signatures](https://github.com/ipfs/go-ipfs/blob/c10f043f3bb7a48e8b43e7f4e35e1cbccf762c68/docs/experimental-features.md#message-signing) 
so that trust of IPFS identities implies trust of the certificates they publish
    1. (Optional) Connect to configured bootstrap IPFS nodes. Failure to connect to bootstrap nodes does not affect success of launch
    1. Determine if there already exists a root account for the given IPFS identity.
        * *If so...* First, determine which local accounts are enabled and have the IPFS identity of the connected node. 
        For each account, subscribe the IPFS node to the pubsub channels they have added
        * *Otherwise...* Create a root account for the in-use IPFS identity. 
        The default password mechanism is to generate a random 128-bit string and convert it to Base64. It is not stored in the database. 
        The PBKDF2 hash of this password is used as the authentication token. It is not stored in the database. 
        The SHA256 hash of this token is stored in the database for later comparison when REST API calls are made using said token. 
        Finally, create a new certificate and save the newly created account and certificate details to the database
    1. Initialize REST paths and launch server on configured port
    
### Runtime Actions
<a name="handle-api-requests"></a>
* **Handle API Requests** - Perform actions specified by the REST requests received on the configured port. Details described below
<a name="dequeue-messages"></a>
* **Dequeue Messages** - Every five minutes, dequeue a message for every enabled account with this IPFS identity on its active group. If a respective account has no active group, then nothing is dequeued for it. 
When dequeuing a message, the server must first generate a random path through the binary group tree (with root `0` and `6` layers, for a total of 63 vertices, numbered breadth first). Then the server must dequeue the 
first message in their queue which is to be sent to a peer whose node in the group intersects the path. If no messages to dequeue have valid recipient for the generated path, or if the message queue is empty, then a 
random message is generated and encrypted to an ephemeral key, then broadcast to all channels on the generated path. If a message does meet the criteria, it is encrypted to the recipient and padded with additional bytes so all 
real and fake messages are of equal size, then broadcast on all channels on the generated path
<a name="receive-messages"></a>
* **Receive Messages** - Ensure message was published with a supported protocol version. Attempt to decrypt the message with all non-expired keys that match the IPFS identity is use. 
If there is a local account whose certificate decrypts the message, store the message under a conversation uniquely identified by the local account, peer account, and group over which the message was sent
<a name="renew-certificates"></a>
* **Renew Certificates** - Every thirty minutes, for every enabled account with this IPFS identity, update its certificate's expiry date to be two weeks from the current time. Then, for each of those account, publish the 
certificate over its active group's certificate channel. If the account does not have an active group, its certificate will not be broadcast. Each certificate broadcast contains a public encryption key, 
a public signing key (not used), the new expiration, and the group nodes the account is currently subscribed to (of which the active account is an element of)
<a name="receive-certificates"></a>
* **Receive Certificates** - Ensure certificate was published with a supported protocol version. If the certificate's public keys are stored locally update the certificate's expiry date and groups. If the certificate is new, 
invalidate any other certificates this peer has published and save the new one

## REST API

### Response Codes
<a name="200"></a>
* **200** - Request was performed successfully
    - This response code is returned if and only if the request was performed without error
<a name="400"></a>
* **400** - Bad Request
    - The client failed to specify required fields
    - ... fields were incorrectly formatted
    - ... gave incorrect parameters for the specified action/request
<a name="401"></a>
* **401** - Unauthorized
    - The client gave an incorrect authentication token
<a name="403"></a>
* **403** - Forbidden
    - The client attempted to view/modify an account it cannot access
    - ... attempted to authorize as an IPFS identity different from that of the connected IPFS node. This is to ensure client knows their broadcasting identity
    - ... attempted to disable the root account
<a name="404"></a>
* **404** - Not Found
    - The client attempted to access a resource that does not exist
    - This can range from deleting a group that does not exist to updating an account which does not exist
    - Enqueuing messages to a peer for whom there is no local certificate will return `404` since the required resource does not yet locally stored
<a name="500"></a>
* **500** - Internal Server Error
    - An internal server error occurred and caused the request to be abandoned prematurely
    
### Returned JSON Objects
* **Account Object**
    - `accountName`: string; the name of the account under of current IPFS identity
    - `enabled`: boolean; true iff the account is set to actively listen for and send messages
    - `peerId`: string; the IPFS identity of the account
    - `activeGroup`: string; the string name the group which is active
* **Conversation Object**
    - `accountName`: string; the account name of the peer being conversed with
    - `height`: non negative integer; the number of messages stored locally in the conversation
    - `group`: string; the name of the group the conversation belongs to
    - `latestStatusChangeDate`: date-string; **YYYY-MM-DDThh:mm:ss.sssZ** representation of the last time a message was added to the conversation
    - `peerId`: string; the IPFS identity of the peer being conversed with
* **Error Object**
    - `error`: string; error message. Every response with a status code other than `200` will contain an error object
* **Group Object**
    - `name`: string; the name of the distort group
    - `subgroup`: non negative integer; the index of the node within the group tree that the account belongs to
* **Message Object**
    - (Received message only,Not implemented always false) `verified`: boolean; true iff the server has verified that the message was signed with the message sender's certificate
    - (Sent message only) `status`: exactly one of strings `enqueued`,`cancelled`,`sent`; 
    the current status of the outgoing message. It is either enqueued to be sent, sent, or cancelled (*cancellation not implemented*)
    - `index`: non negative integer; zero-indexed position of the message chronologically 
    - `message`: string; the plaintext contents of the message
    - (Received message only) `dateReceived`: date-string; **YYYY-MM-DDThh:mm:ss.sssZ** representation of UTC time the message was received
    - (Sent message only) `lastStatusChange`: date-string; **YYYY-MM-DDThh:mm:ss.sssZ** representation of the last time this message's status was changed
* **Peer Object**
    - `accountName`: string; the name of the account under of IPFS identity. Defaults to `root`
    - (Optional) `nickname`: string; a locally unique identifier for this account
    - `peerId`: string; the IPFS identity of the peer
    - `groups`: array of strings; the set of groups subscribed to by the certificate's owner
* **Server-Message Object**
    - `message`: string; a string response from the server

---

### Unauthenticated Requests
Request paths:
<a name="ipfs"></a>
* **/ipfs**
    * **GET** - Fetch IPFS node ID
        - Return: server-message object; server-message containing the actively connected IPFS node's ID
<a name="create-account"></a>
* **/create-account**
    * **POST** - Create account
        - Body parameters:
            - `peerId`: string; the IPFS identity to create the account for. "root" account for this identitity must sign `accounName`
            - `accountName`: string; the name to assign to the new account
            - `authToken`: string; the string token that will be used to authorize account operations. Recommended to be a password hash using PBKDF2 parameter with SHA256 and 1000, then encode with base64
            - `signature`: string; the hexadecimal signature string created by the "root" account of the specified IPFS identity. This token allows for the creation of an account with the signed account name
        - Action: creates an account with the specified properties and generates a new key pair. Does not subscribe to any groups
        - Return: account object; details of the newly created account
        
### Authenticated Requests
Note: Authenticated requests require the following headers: 
* `peerid`: string; the IPFS node ID of the account to authorize as. Must be equal to the IPFS ID of the current node in use
* `authtoken`: string; the token used to authenticate all requests. Recommended to be equal to the Base64 encoding of a hash of the account's password. 
Hash algorithm is PBKDF2 using SHA-256. The salt is the IPFS node ID (equivalent to `peerid`), and the work-constant is `1000`
* (Optional) `accountname`: string; the name of the account to authorize as. Will default to `root` if this field is not specified or is the empty string

Request paths:
<a name="groups"></a>
* **/groups**
	* **GET** - Fetch groups
        - Return: array of group objects; the groups that the authenticated account belongs to
    * **POST** - Add group
        - Body parameters:
            - `name`: string; the name of the group
            - `subgroupLevel`: non-negative integer; the group-tree depth to join
        - Action: adds the specified group with a random node at the given depth. 
        If the authenticating account is already subscribed to the named channel, only the node index is updated
        - Return: group object; the details of the added group
<a name="groups-name"></a>
* **/groups/:group-name**
	* **GET** - Fetch conversations in group
	    - Return: array of conversation objects; the conversations contained in group `group-name`
	* **PUT** - Enqueue message to peer
        - Body parameters:
            - `message`: string; the plaintext of the message to enqueue
            - *Either...*
                - `toPeerId`: string; the IPFS node ID of the peer to message
                - (Optional) `toAccountName`: string; the account name of the peer. If not specified, defaults to `root`
            - *or...*
                - `toNickname`: string; the user specified nickname of the peer
        - Action: enqueues message in the conversation uniquely specified by the group `group-name` and the identified peer
        - Return: message object; details of the enqueued outgoing message
	* **DELETE** - Leave group
	    - Action: leaves the group `group-name` and deletes all conversations and messages within
	    - Return: server-message object; server-message containing a success string
<a name="groups-name-index"></a>
* **/groups/:group-name/:index-start/[:index-end]**
	* **GET** - Read messages from conversation within range specified by `index-start` and optionally `index-end`, inclusively. End defaults to the last index in the database
        - Additional request headers:
            * `conversationpeerid`: string; the IPFS node ID of the peer being conversed with in group `group-name`
            * (Optional) `conversationaccountname`: string; the account name of the peer being conversed with. Defaults to `root`
	    - Return: JSON object containing three fields, `conversation`, `in`, and `out`; the first is a string ID uniquely identifying the conversation's local object. 
	    The latter two are arrays of received and sent message objects respectively.
	    contains all received and sent messages in the uniquely specified conversation that have indices between `index-start` and `index-end` inclusively
<a name="account"></a>
* **/account**
	* **GET** - Fetch account
	    - Body Parameters:
	        - (Optional) `accountName`: string; the name of the account to retrieve. Only the `root` account can retrieve other accounts
        - Return: account object; details of the account that authorized the request, or the specified account if `root`
	* **PUT** - Update account settings
	    - Body Parameters:
	        - (Optional) `accountName`: string; the name of the account to update. Only the `root` account can modify accounts other than itself
	        - (Optional) `activeGroup`: string; the name of the group to make active on the account. If an active group is set, the empty string removes the active group
	        - (Optional) `enabled`: string; truth value to assign to the specified account's enabled status, `true` or `false`. Only non-root accounts can be disabled
	        - (Optional) `authToken`: string; new string to use as the authorization token. Conceptually equivalent to changing a password. Cannot be empty
	    - Action: updates the specified or authorizing account using the defined body parameters, does not change unspecified values
	    - Return: account object; the details of the modified account after applying changes
	* **DELETE** - Remove account - *Only root accounts can perform this action*
	    - Body parameters:
	        - `accountName`: string; the name of the account to remove. Field is required
	    - Action: removes the specified account as well as their conversations and groups
        - Return: server-message object; server-message containing a success string
<a name="peers"></a>
* **/peers**
	* **GET** - Fetch peers
        - Return: array of peer objects; details of all the peers the authorized account has explicitly added
	* **POST** - Add peer
	    - Body Parameters:
	        - `peerId`: string; the IPFS node ID of the peer to add
	        - (Optional) `accountName`: string; the account name of the peer. Defaults to `root`
	        - (Optional) `nickname`: string; a human friendly name to assign to the peer
	    - Action: on the condition that there is a local entry for the specified peer's certificate, creates an entry for the peer using the given information. 
	    If the authenticating account already has an entry for the specified peer, only the nickname is updated
	    - Return: peer object; details of the created peer. If there is no local certificate for the specified peer, the request fails and error `404` is returned
	* **DELETE** - Remove peer
	    - Body parameters:
	        - `peerId`: string; the IPFS node ID of the peer to remove
	        - (Optional) `accountName`: string; the account name of the peer. Defaults to `root`
	    - Action: removes the specified peer from the local database list of peers
        - Return: server-message object; server-message containing a success string
<a name="signatures"></a>
* **/signatures**
    * **GET** - Sign text
        - Body Parameters:
	        - `plaintext`: string; the text to sign
	    - Return: server-message object; hexadecimal string encoding of the requested signature
	* **POST** - Verify signature
        - Body Parameters:
	        - `peerId`: string; the IPFS identity of the signing peer
	        - `accountName`: string; the account of the signing peer
	        - `plaintext`: string; the text to verify was signed by the specified peer
	        - `signature`: string; the signature to verify
	    - Return: server-message object; message `true` if the signature is verified, `false` otherwise
