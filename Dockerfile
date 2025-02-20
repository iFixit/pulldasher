FROM node:18-alpine

RUN mkdir -p /opt/pulldasher
WORKDIR /opt/pulldasher

# Install dependencies
COPY . /opt/pulldasher
RUN npm install --unsafe-perm
ENV DEBUG=pulldasher:*

EXPOSE 8080
CMD ["bin/pulldasher"]
