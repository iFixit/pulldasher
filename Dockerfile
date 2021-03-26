FROM node:latest

WORKDIR /opt/pulldasher

# Install dependencies
COPY . /opt/pulldasher
RUN npm install --unsafe-perm
ENV DEBUG=pulldasher:*

EXPOSE 8080
CMD ["bin/pulldasher"]

