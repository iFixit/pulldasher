module.exports = {
   /**
    * Converts `t` to a Unix timestamp from a Date object unless it's already
    * a number.
    */
   toUnixTime: function(date) {
      return (date && (typeof date) === 'object') ? date.getTime() / 1000 : date;
   },

   /**
    * Converts `t` to a Date object from a Unix timestamp unless it's not a
    * number.
    */
   fromUnixTime: function(t) {
      return (typeof t) === 'number' ? new Date(t * 1000) : t;
   },

   /**
    * Converts `str` to a Date object from a Date string (or null).
    * Returns null if str is falsy.
    */
   fromDateString: function(str) {
      return str ? ((str instanceof Date) ? str : new Date(str)) : null;
   },
};
