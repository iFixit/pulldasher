/**
 * Represents a column of pull requests on the page.
 *
 * Column takes care of rendering a column template onto the page. Each Column
 * receives an array of Pull objects via its update method and converts them to
 * jQuery elements, which it inserts into its rendering.
 */
define(['jquery', 'underscore', 'Templates', 'bootstrap'],
 function($, _, Templates, bootstrap) {
   /**
    * Constructor
    *
    * @param elementFilter - An ElementFilter which will be used to transform
    * the displayed elements in this column.
    *
    * @param spec - The specification for this column. This is a JavaScript
    * object which provides information about the name and id of this column
    * and about the page template. It allows this function to be more
    * general-purpose.
    */
   var constructor = function(elementFilter, indicatorFilter, spec) {
      var self = this;

      // The DOM node that holds all the elements for this column. Remove it, and
      // it is as if this column never existed (although there's still the
      // columnRestore button--to really remove the entire column, you have to
      // remove that too.)
      var column;

      // The button to uncollapse this column.
      var columnRestore;

      // The part of this column that actually holds pull elements.
      var container;

      // Private methods
      
      /**
       * Renders the button that can be used to restore the column when it is
       * collapsed. Is only called if the button needs to be rendered.
       */
      var renderRestore = function renderRestore() {
         return Templates.renderIntoContainer('restore', spec, $(spec.navbar));
      };

      /**
       * Renders this column's basic structure. That does not include the pulls
       * in the column, only the structure that surrounds them.
       */
      var renderColumn = function renderColumn() {
         return Templates.renderIntoContainer('column', spec, $('#' + spec.id + '-container'));
      };

      /**
       * Add element to this column.
       */
      var addElement = function addElement(element) {
         container.append(element);
      };

      /**
       * Creates a DOM node from the pull and overwrites whatever was currently
       * stored as the DOM node for that pull with the newly-created node.
       * Allows user code to adjust the node through the adjust method hook by
       * applying this column's ElementFilter to the resulting nodes
       * @return a jQuery object containing the new DOM node
       */
      var createDOMNode = function createDOMNode(pull) {
         var html = self.renderPull(pull);
         var elem = $($.parseHTML(html));

         if (elementFilter) {
            elementFilter.filter(pull, elem);
         }


         if (indicatorFilter) {
            indicatorFilter.filter(pull, elem, function(elem, filterName) {
               // Find the #indicators container
               var indicators = elem.find('#indicators');

               // Render the 'indicator' template into the indicators element
               return Templates.renderIntoContainer('indicator', {name: filterName}, indicators);
            });
         }

         return elem;
      };

      /**
       * Creates a DOM node for a pull and adds it to this column.
       */
      var addPullToEndOfColumn = function addPullToEndOfColumn(pull) {
         var elem = createDOMNode(pull);
         addElement(elem);
      };

      /**
       * Remove all the items in a column.
       */
      var clearColumn = function clearColumn() {
         container.empty();
      };

      /**
       * Replaces the current contents of this column with the pulls in
       * pullList.
       */
      var setPulls = function setPulls(pullList) {
         clearColumn();
         _.each(pullList, addPullToEndOfColumn);

         updateCountBadge();

         if (spec.triggers && spec.triggers.onUpdate instanceof Function) {
            spec.triggers.onUpdate(column, container);
         }
      };

      /**
       * Updates the badge on this column with the number of pulls in the
       * column.
       */
      var updateCountBadge = function updateCountBadge() {
         var count = container.find('.pull').length;
         column.find('.pull-count').text(count);

         if (columnRestore) {
            columnRestore.find('.pull-count').text(count);
         }
      };

      /**
       * Adds the event handlers to make this column disappear and its restore
       * button appear when the header is clicked. Also adds the handler to
       * make the restore button restore the column correctly.
       */
      var addCollapseSwap = function addCollapseSwap() {
         // 'hidden.bs.collapse' is provided by Bootstrap. It's an event that
         // occurs when a collapsible thing is collapsed. See
         // http://getbootstrap.com/javascript/#collapse-usage
         column.on('hidden.bs.collapse', function hideColumn() {
            column.fadeOut();
            columnRestore.fadeIn();
         });

         columnRestore.on('click', function restoreColumn() {
            columnRestore.fadeOut();
            column.fadeIn();
            container.collapse('show');
         });
      };

      _.extend(this, {
         /**
          * update is called to update the column with a new list of pulls.
          */
         update: setPulls,

         /**
          * Renders the HTML for a pull. spec.templateName and spec.data both
          * affect this function.
          */
         renderPull: function renderPull(pull) {
            var template = Templates.get(spec.templateName || 'pull');

            var data = _.clone(pull);
            if (spec.data) {
               _.defaults(data, spec.data);
            }

            return template(pull);
         }
      });

      column = renderColumn();

      // Store the location of the column container
      container = column.find('#' + spec.id);

      // Render the restore button (if needed)
      if (spec.shrinkToButton) {
         columnRestore = renderRestore();
         addCollapseSwap();
      }

      // Run onCreate triggers for user modification of pulls
      if (spec.triggers && spec.triggers.onCreate instanceof Function) {
         spec.triggers.onCreate(column, container);
      }
   };

   return constructor;
});
