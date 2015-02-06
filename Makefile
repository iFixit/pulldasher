.PHONY: setup run

setup:
	npm install
	bower install
	grunt

run: setup
	./bin/pulldasher
