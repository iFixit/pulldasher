var Promise = require('bluebird'),
    debug = require('./debug')('pulldasher:rate-limit');

// Number of remaining requests that will activate the rate-limiter.
// 5000 == always rate limit
// 1000 == let 4000 requests go as fast as they can, then limit to one per 3s
// Effectively, higher = more steady, but slow, lower = fast bursts, but much
// slower as we get closer to the limit
var chokePoint = 2000;

// Wraps a promise returing function in a function that checks responses for
// github's rate-limit headers and delays firing of requests to attempt to
// stay under the rate limit.
module.exports = function rateLimit(promiseFunc) {
   return function(...args) {
      return throttleRequest().then(function() {
         return promiseFunc.apply(null, args);
      }).then(captureRateLimitInfo);
   };
};

// FIFO queue of request callbacks to github
var requestQueue = [];
// number of requests remaining before we hit the rate limit
var remaining = null;
// timestamp of the next time rate limit will be reset
var resetAt;

/**
 * Return a promise that resolves immediately (if we don't need to slow down)
 * or resolves later with a delay if we need to stay under the rate limit.
 */
function throttleRequest() {
   if (remaining !== null && remaining < chokePoint) {
      return new Promise(function (resolve, reject) {
         queue(resolve);
         debug("Request queued because remaining (%s) is less than choke-point (%s). Queue-length: %s ", remaining, chokePoint, requestQueue.length);
      });
   }
   debug("Not throttling requests because choke-point (%s) not hit yet (%s)", chokePoint, remaining);
   return Promise.resolve();
}

/**
 * Records the rate limit headers from a response and returns the response
 *
 * Can be injected in a .then() chain and won't change the resolved value
 */
function captureRateLimitInfo(response) {
   var headers = response && response.headers;
   if (headers && headers['x-ratelimit-remaining']) {
      remaining = Number(headers['x-ratelimit-remaining']);
      if (headers['x-ratelimit-reset']) {
         resetAt = Number(headers['x-ratelimit-reset']);
      }
      debug("Response received, requests remaining: %s reset at: %s", remaining, resetAt);
   }
   return response;
}

var drainer;
function drainOne() {
   if (requestQueue.length) {
      var resolve = requestQueue.shift();
      resolve();
      var delay = interval();
      if (requestQueue.length) {
         debug("Executed request from queue, next request in %s ms", delay);
      } else {
         debug("Executed request from queue, queue is now empty");
      }
      drainer = setTimeout(drainOne, delay);
   } else {
      drainer = null;
   }
}

function queue(resolve) {
   requestQueue.push(resolve);
   startDrainer();
}

function startDrainer() {
   if (!drainer) {
      drainOne();
   }
}

function interval() {
   var requestsRemaining = Math.max(1, remaining);
   // Always underconsume, and leave a minute's worth of requests remaining
   // just in case our clock drifts from githubs
   var timeTillReset = Math.max(1, (60 + resetAt) * 1000 - Date.now());
   return timeTillReset / requestsRemaining;
}
