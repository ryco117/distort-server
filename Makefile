all: src/sjcl.js

sjcl/sjcl.js:
	git submodule init
	[ -f sjcl/configure ] || git submodule update
	cd sjcl && ./configure --compress=closure --with-all && make

src/sjcl.js: sjcl/sjcl.js
	mkdir -p ./src
	cp sjcl/sjcl.js ./src/sjcl.js

clean:
	rm -f src/sjcl.js sjcl/sjcl.js
