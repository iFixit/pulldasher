FROM node:latest

RUN mkdir -p /opt/pulldasher
WORKDIR /opt/pulldasher

# Install dependencies
COPY package.json /opt/pulldasher
RUN npm install

COPY . /opt/pulldasher

# TODO Run webpack build

EXPOSE 8080
CMD ["bin/pulldasher"]
