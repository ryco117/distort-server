all: node_modules/sjcl.js

sjcl/sjcl.js:
	git submodule init
	[ -f sjcl/configure ] || git submodule update
	cd sjcl && ./configure --compress=closure --with-all && make

node_modules/sjcl.js: sjcl/sjcl.js
	mkdir -p ./node_modules
	cp sjcl/sjcl.js ./node_modules/sjcl.js

clean:
	rm -f node_modules/sjcl.js sjcl/sjcl.js
