/**
 * Represents a column of pulls
 */
define(['jquery', 'underscore', 'Templates'], function($, _, Templates) {
   /**
    * Constructor
    *
    * @param thePullFilter A PullFilter which will provide the pulls to display in this column.
    * @param theElementFilter An ElementFilter which will be used to transform
    * the displayed elements in this column.
    * @param theSpec The specification for this column.
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

      // A map from Pull objects to their associated DOM elements in this
      // column. Used to avoid re-rendering pulls
      var pullsToElems = {};

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

      var renderRestore = function() {
         return renderInto('restore', spec, $(spec.navbar));
      };

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
       * Creates a DOM node if one does not already exsist. Otherwise, returns
       * the existing DOM node.
       */
      var getDOMNode = function(pull) {
         var elem = pullsToElems[pull.number];
         if (elem) {
            return elem;
         } else {
            return createDOMNode(pull);
         }
      };

      /**
       * Creates a DOM node from the pull and overwrites whatever was currently
       * stored as the DOM node for that pull with the newly-created node.
       * Allows user code to adjust the node through the adjust method hook
       */
      var createDOMNode = function(pull) {
         var html = self.renderPull(pull);
         var elem = $.parseHTML(html);
         pullsToElems[pull.number] = elem;

         elementFilter.filter(pull, elem);

         return elem;
      };

      /**
       * Removes a pull from this column. Re-adding it will cause it to be
       * recreated from scratch.
       */
      var removePull = function(pull) {
         var elem = pullsToElems[pull.number];
         elem.remove();
         delete pullsToElems[pull.number];
      };

      /**
       * Gets a DOM node for a pull and adds it to this column.
       */
      var addPullToEndOfColumn = function(pull) {
         var elem = getDOMNode(pull);
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
      };

      _.extend(this, {
         /**
          * update is called to update the column with a new list of pulls.
          */
         update: setPulls,

         /**
          * Rebuilds the column using the data in pullList with the specified
          * pull re-rendered.
          *
          * Used when changing the data in a pull, to prevent old data from
          * showing up.
          */
         refreshPull: function(pull, pullList) {
            // So that we don't have the old data in the node. A new DOM node will
            // be automatically created when setPulls finds it missing.
            removePull(pull);
            setPulls(pullList);
         },

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

      column = renderColumn();

      // Store the location of the column container
      container = column.find('#' + spec.id);

   };

   return constructor;
});
