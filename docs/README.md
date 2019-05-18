# DistoRt Homeserver
([main page](https://ryco117.github.io/distort-server))

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
    - An internal server error occured and caused the request to be abandoned prematurely

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
