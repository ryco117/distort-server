# DistoRt Homeserver
([main page](https://ryco117.github.io/distort-server))

## Server Overview
### Configuration
The server is configurable by the top-level JSON file `config.json`. It features several features:
* `debug`: boolean; print debug-level information to the console iff this key has a positive truthyness value
* `ipfsNode`: object; information on the IPFS node to use for IPFS API and as the node's identity
    * `address`: string; IP or domain address of the IPFS node to use
    * `bootstrap`: array of strings; A list of [IPFS multiaddrs](https://github.com/ipfs/go-ipfs-addr) to connect to at server start, 
    to help bootstrap connectivity between DistoRt peers
    * `port`: positive integer; API port of the IPFS node to use
* `mongoAddress`: string; the string to use to connect to the MongoDB to use. Eg., "mongodb://mongo:27017/distort"
* `port`: positive integer; the local port to open for REST API calls
* `protocolVersion`: string; the version string of the protocol this server will implement. Eg., "0.1.0"

### Launch
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

## REST API

### Error Codes
* **400** - Bad Request
    - The client failed to specify required fields
    - ... fields were incorrectly formatted
    - ... gave incorrect parameters for the specified action/request
* **401** - Unauthorized
    - The client attempted to authorize as an account which does not exist
    - ... gave an incorrect authorization token
* **403** - Forbidden
    - The client attempted to view/modify an account it cannot access
    - ... attempted to authorize as an IPFS identity different from that of the connected IPFS node. This is to ensure client knows their broadcasting identity
* **500** - Internal Server Error
    - An internal server error occurred and caused the request to be abandoned prematurely

---

### Unauthenticated Requests
Request paths:
* **/ipfs**
    * **GET** - Fetch IPFS node ID
        - Return: string, the actively connected IPFS node's ID
        
### Authenticated Requests
Note: Authenticated requests require the following headers: 
* `peerid`: string; the IPFS node ID of the account to authorize as. Must be equal to the IPFS ID of the current node in use
* `authtoken`: string; the token used to authenticate all requests. Recommended to be equal to the Base64 encoding of a hash of the account's password. Hash algorithm is PBKDF2 using SHA-256. The salt is the IPFS node ID (equivalent to `peerid`), and the work-constant is `1000`
* (Optional) `accountname`: string; the name of the account to authorize as. Will default to `root` if this field is not specified or is the empty string

Request paths:
* **/groups**
	* **GET** - Fetch groups
        - Return: array of group objects; the groups that the authenticated account belongs to
    * **POST** - Add group
        - Body parameters:
            - `name`: string; the name of the group
            - `subgroupLevel`: non-negative integer; the group-tree depth to join
        - Action: adds the specified group with a random node at the given depth
        - Return: group object; the details of the added group
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
	    - Action: leaves the group `group-name` 
	    - Return: JSON object; an object containing only the field `message` set to a success string
* **/groups/:group-name/:index-start/[:index-end]**
	* **GET** - Read messages from conversation within range specified by `index-start` and optionally `index-end`, inclusively. End defaults to the last index in the database
        - Additional request headers:
            * `conversationpeerid`: string; the IPFS node ID of the peer being conversed with in group `group-name`
            * (Optional) `conversationaccountname`: string; the account name of the peer being conversed with. Defaults to `root`
	    - Return: JSON object containing two fields, `in` and `out`, each of which are arrays of received and sent message objects respectively; contains all received and sent messages in the uniquely specified conversation that have indices between `index-start` and `index-end` inclusively
* **/account**
	* **GET** - Fetch account
	    - Body Parameters:
	        - (Optional) `accountName`: string; the name of the account to retreive. Only the `root` account can retrieve other accounts
        - Return: account object; details of the account that authorized the request, or the specified account if `root`
	* **PUT** - Update account settings
	    - Body Parameters:
	        - (Optional) `accountName`: string; the name of the account to update. Only the `root` account can modify accounts other than itself
	        - (Optional) `activeGroup`: string; the name of the group to make active on the account. If an active group is set, the empty string removes the active group
	        - (Optional) `enabled`: string; truth value to assign to the specified account's enabled status, `true` or `false`. Only non-root accounts can be disabled
	        - (Optional) `authToken`: string; new string to use as the authorization token. Conceptually equal to changing a password. Cannot be empty
	    - Action: updates the specified or authorizing account using the defined body parameters, does not change unspecified values
	    - Return: account object; the details of the modified account after applying changes
* **/peers**
	* **GET** - Fetch peers
        - Return: array of peer objects; details of all the peers the authorized account has explicitly added
	* **POST** - Add peer
	    - Body Parameters:
	        - `peerId`: string; the IPFS node ID of the peer to add
	        - (Optional) `accountName`: string; the account name of the peer. Defaults to `root`
	        - (Optional) `nickname`: string; a human friendly name to assign to the peer
	    - Action: on the condition that there is a local entry for the specified peer's certificate, creates an entry for the peer using the given information 
	    - Return: peer object; details of the created peer. If there is no local certificate for the specified peer, no peer is creates and error `400` is returned
	* **DELETE** - Remove peer
	    - Body parameters:
	        - `peerId`: string; the IPFS node ID of the peer to remove
	        - (Optional) `accountName`: string; the account name of the peer. Defaults to `root` 
        - Return: JSON object; an object containing only the field `message` set to a success string
