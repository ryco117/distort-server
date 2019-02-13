# DistoRt Homeserver
([main page](https://ryco117.github.io/distort-server))

## REST API
### Unauthenticated
* **/ipfs**
    * **GET** - Fetch IPFS node ID
        - Return: string, the actively connected IPFS node's ID
        
### Authenticated
* **/groups**
	* **GET** - Fetch groups
        - Return: array of group objects, the groups that the authenticated account belongs to
    * **POST** - Add group
        - Body parameters:
            - `name` set to the name of the group
            - `subgroupLevel` set as a non-negative integer for the group-tree depth to join
        - Action: adds specified group at given depth
        - Return: group object, details of the added group
* **/groups/:group-name**
	* **GET** - Fetch conversations in group
	    - Return: array of conversation objects, the conversations under group `group-name` that have been started (meaning at least one message has been sent or received)
	* **PUT** - Enqueue message to peer
        - Body parameters:
            - `message` set to the plaintext of the message to enqueue
            - `toPeerId` set to the IPFS node ID of the peer
            - (Optional) `toAccountName` set to the account name of the peer. Defaults to "root"
            - `toNickname` set to the friendly nickname set for the peer
            
            Note: peer specified by either `toNickname` or by `toPeerId` [ + `toAccountName`]
        - Action: Enqueues message in conversation
        - Return: message object, details of the enqueued outgoing message
	* **DELETE** - Leave group
	    - Action: leaves the group `group-name` 
	    - Return: json object, object containing the field `message` set to a success message string
* **/groups/:group-name/:index-start/[:index-end]**
	* **GET** - Read conversation messages within range
        - Additional request headers:
            * `conversationpeerid` set to the IPFS node ID of the peer being conversed with in group `group-name`
            * (Optional) `conversationaccountname` set to the account name of the peer being conversed with. Defaults to `root`
	    - Return: an object containing two fields, `in` and `out`, each of which are arrays of message objects, all received and sent (respectively) messages (in the uniquely specified conversation), with indicies between `index-start` and `index-end` (inclusively)
* **/account**
	* **GET** - Fetch account
        - Return: account object, details of the account used to authorize request
	* **PUT** - Update account settings
* **/peers**
	* **GET** - Fetch peers
        - Return: array of peer objects, details of all the peers the authorized account has explicitly added
	* **POST** - Add peer
	* **DELETE** - Remove peer
	
---
Note: Authenticated HTTP requests take headers: 
* `peerid` set to the IPFS node ID of the account to authorize as. Must be equal to the IPFS ID of the current node in use
* `authtoken` set to the Base64 encoded hash of the account's password. Hash algorithm is PBKDF2 using SHA-256. The salt is the IPFS node ID (equivalent to `peerid`), and the work-constant is `1000`
* (Optional) `accountname` set to the name of the account to authorize as. If field is not specified or empty, will default to `root`

