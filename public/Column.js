/**
 * Represents a column of pulls
 */
define(['jquery', 'underscore', 'Templates'], function($, _, Templates) {
   /**
    * Constructor
    *
    * @param theElementFilter An ElementFilter which will be used to transform
    * the displayed elements in this column.
    *
    * @param theSpec The specification for this column. This is a JavaScript
    * object which provides information about the name and id of this column
    * and about the page template. It allows this function to be more
    * general-purpose.
    */
   var constructor = function(elementFilter, spec) {
      var self = this;

      // The DOM node that holds all the pretty for this column. Remove it, and
      // it is as if this column never existed (sorta).
      var column;

      // The button to uncollapse this column.
      var columnRestore;

      // The part of this column that actually holds pull elements.
      var container;

      // Private methods
      
      /**
       * Renders a template with provided data and appends the resulting node
       * to the end of the JQuery object container.
       */
      var renderInto = function(template, data, container) {
         var templateFunction = Templates.get(template);
         var html = templateFunction(data);
         var node = $(html);
         container.append(node);

         return node;
      };

      /**
       * Renders the button that can be used to restore the column when it is
       * collapsed. Is only called if the button needs to be rendered.
       */
      var renderRestore = function() {
         return renderInto('restore', spec, $(spec.navbar));
      };

      /**
       * Renders this column's basic structure. That does not include the pulls
       * in the column, only the pretty that surrounds them.
       */
      var renderColumn = function() {
         return renderInto('column', spec, $('#' + spec.id + '-container'));
      };

      /**
       * Add element to this column.
       */
      var addElement = function(element) {
         container.append(element);
      };

      /**
       * Creates a DOM node from the pull and overwrites whatever was currently
       * stored as the DOM node for that pull with the newly-created node.
       * Allows user code to adjust the node through the adjust method hook
       */
      var createDOMNode = function(pull) {
         var html = self.renderPull(pull);
         var elem = $.parseHTML(html);

         elementFilter.filter(pull, elem);

         return elem;
      };

      /**
       * Gets a DOM node for a pull and adds it to this column.
       */
      var addPullToEndOfColumn = function(pull) {
         var elem = createDOMNode(pull);
         addElement(elem);
      };

      /**
       * Remove all the items in a column.
       */
      var clearColumn = function() {
         container.empty();
      };

      /**
       * Replaces the current contents of this column with the pulls in
       * pullList.
       */
      var setPulls = function(pullList) {
         clearColumn();
         _.each(pullList, addPullToEndOfColumn);

         updateCountBadge();
      };

      var updateCountBadge = function() {
         var count = container.find('.pull').length;
         column.find('.pull-count').text(count);

         if (columnRestore) {
            columnRestore.find('.pull-count').text(count);
         }
      };

      _.extend(this, {
         /**
          * update is called to update the column with a new list of pulls.
          */
         update: setPulls,

         /**
          * Renders the HTML for a pull. spec.templateName and spec.data both
          * affect this function
          */
         renderPull: function(pull) {
            var template = Templates.get(spec.templateName || 'pull');

            var data = _.clone(pull);
            if (spec.data) {
               _.defaults(data, spec.data);
            }

            return template(pull);
         }
      });

      // Render the restore button (if needed)
      if (spec.shrinkToButton) {
         columnRestore = renderRestore();
         // TODO: Link button and container correctly
      }

      column = $(renderColumn());

      // Store the location of the column container
      container = column.find('#' + spec.id);

   };

   return constructor;
});
