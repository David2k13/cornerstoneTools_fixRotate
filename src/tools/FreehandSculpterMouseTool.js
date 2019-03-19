import EVENTS from '../events.js';
import external from '../externalModules.js';
import toolColors from '../stateManagement/toolColors.js';
import drawHandles from '../drawing/drawHandles.js';
import { state } from '../store/index.js';
import { getToolState } from '../stateManagement/toolState.js';
import { clipToBox } from '../util/clip.js';
import getToolForElement from '../store/getToolForElement.js';
import BaseTool from './base/BaseTool.js';
import { hideToolCursor, setToolCursor } from '../store/setToolCursor.js';

import freehandUtils from '../util/freehand/index.js';

const { FreehandHandleData } = freehandUtils;

/**
 * @public
 * @class FreehandSculpterMouseTool
 * @memberof Tools
 *
 * @classdesc Tool for easily sculpting annotations drawn with
 * the FreehandMouseTool.
 * @extends Tools.Base.BaseTool
 */
export default class FreehandSculpterMouseTool extends BaseTool {
  constructor(configuration = {}) {
    const defaultConfig = {
      name: 'FreehandSculpterMouse',
      referencedToolName: 'FreehandMouse',
      supportedInteractionTypes: ['Mouse'],
      mixins: ['activeOrDisabledBinaryTool'],
      configuration: getDefaultFreehandSculpterMouseToolConfiguration(),
      svgCursor: freehandSculpterCursor,
    };
    const initialConfiguration = Object.assign(defaultConfig, configuration);

    super(initialConfiguration);

    this.hasCanvasCursor = true;
    this.isMultiPartTool = true;
    this.initialConfiguration = initialConfiguration;
    this.referencedToolName = initialConfiguration.referencedToolName;

    this._active = false;

    // Create bound functions for private event loop.
    this.activeMouseUpCallback = this.activeMouseUpCallback.bind(this);
    this.activeMouseDragCallback = this.activeMouseDragCallback.bind(this);
  }

  renderToolData(evt) {
    const eventData = evt.detail;

    if (this.configuration.currentTool === null) {
      return false;
    }

    const element = eventData.element;
    const config = this.configuration;

    const toolState = getToolState(element, this.referencedToolName);
    const data = toolState.data[config.currentTool];

    if (!data) {
      return false;
    }

    if (this._active) {
      const context = eventData.canvasContext.canvas.getContext('2d');
      const options = {
        color: this.configuration.dragColor,
        fill: null,
        handleRadius: this._toolSizeCanvas,
      };

      drawHandles(
        context,
        eventData,
        this.configuration.mouseLocation.handles,
        options
      );
    } else if (this.configuration.showCursorOnHover) {
      this._renderHoverCursor(evt);
    }
  }

  doubleClickCallback(evt) {
    const eventData = evt.detail;

    this._selectFreehandTool(eventData);

    external.cornerstone.updateImage(eventData.element);
  }

  /**
   * Event handler for MOUSE_DOWN.
   *
   * @param {Object} evt - The event.
   * @returns {boolean}
   */
  preMouseDownCallback(evt) {
    const eventData = evt.detail;
    const config = this.configuration;

    if (config.currentTool === null) {
      this._selectFreehandTool(eventData);
    }

    this._initialiseSculpting(eventData);

    external.cornerstone.updateImage(eventData.element);

    return true;
  }

  /**
   * Event handler for MOUSE_DRAG during the active loop.
   *
   * @event
   * @param {Object} evt - The event.
   * @returns {void}
   */
  activeMouseDragCallback(evt) {
    const config = this.configuration;

    if (!this._active) {
      return;
    }

    const eventData = evt.detail;
    const toolState = getToolState(eventData.element, this.referencedToolName);

    if (!toolState) {
      return;
    }

    const points = toolState.data[config.currentTool].handles.points;

    // Set the mouseLocation handle
    this._getMouseLocation(eventData);
    this._sculpt(eventData, points);

    // Update the image
    external.cornerstone.updateImage(eventData.element);
  }

  /**
   * Event handler for MOUSE_UP during the active loop.
   *
   * @param {Object} evt - The event.
   * @returns {void}
   */
  activeMouseUpCallback(evt) {
    const eventData = evt.detail;
    const element = eventData.element;
    const config = this.configuration;

    this._active = false;

    state.isMultiPartToolActive = false;

    this._getMouseLocation(eventData);
    this._invalidateToolData(eventData);

    config.mouseUpRender = true;

    this._deactivateSculpt(element);

    // Update the image
    external.cornerstone.updateImage(eventData.element);

    preventPropagation(evt);
  }

  /**
   * Renders the cursor
   *
   * @private
   * @param  {type} evt description
   * @returns {void}
   */
  _renderHoverCursor(evt) {
    const eventData = evt.detail;
    const element = eventData.element;
    const context = eventData.canvasContext.canvas.getContext('2d');

    const toolState = getToolState(element, this.referencedToolName);
    const data = toolState.data[this.configuration.currentTool];

    let coords;

    if (this.configuration.mouseUpRender) {
      coords = this.configuration.mouseLocation.handles.start;
      this.configuration.mouseUpRender = false;
    } else {
      coords = state.mousePositionImage;
    }

    const freehandMouseTool = getToolForElement(
      element,
      this.referencedToolName
    );
    let radiusCanvas = freehandMouseTool.distanceFromPointCanvas(
      element,
      data,
      coords
    );

    this.configuration.mouseLocation.handles.start.x = coords.x;
    this.configuration.mouseLocation.handles.start.y = coords.y;

    if (this.configuration.limitRadiusOutsideRegion) {
      const unlimitedRadius = radiusCanvas;

      radiusCanvas = this._limitCursorRadiusCanvas(eventData, radiusCanvas);

      // Fade if distant
      if (
        unlimitedRadius >
        this.configuration.hoverCursorFadeDistance * radiusCanvas
      ) {
        context.globalAlpha = this.configuration.hoverCursorFadeAlpha;
      }
    }

    const options = {
      fill: null,
      color: this.configuration.hoverColor,
      handleRadius: radiusCanvas,
    };

    drawHandles(
      context,
      eventData,
      this.configuration.mouseLocation.handles,
      options
    );

    if (this.configuration.limitRadiusOutsideRegion) {
      context.globalAlpha = 1.0; // Reset drawing alpha for other draw calls.
    }
  }

  /**
   * Event handler for NEW_IMAGE event.
   *
   * @public
   * @param {Object} evt - The event.
   * @returns {void}
   */
  newImageCallback(evt) {
    this._deselectAllTools(evt);
  }

  /**
   * Event handler for switching mode to enabled.
   *
   * @public
   * @param {Object} evt - The event.
   * @returns {void}
   */
  enabledCallback(evt) {
    this._deselectAllTools(evt);
  }

  /**
   * Event handler for switching mode to passive.
   *
   * @public
   * @param {Object} evt - The event.
   * @returns {void}
   */
  passiveCallback(evt) {
    this._deselectAllTools(evt);
  }

  /**
   * Event handler for switching mode to disabled.
   *
   * @public
   * @param {Object} evt - The event.
   * @returns {void}
   */
  disabledCallback(evt) {
    this._deselectAllTools(evt);
  }

  /**
   * Select the freehand tool to be edited.
   *
   * @private
   * @param {Object} eventData - Data object associated with the event.
   * @returns {void}
   */
  _selectFreehandTool(eventData) {
    const config = this.configuration;
    const element = eventData.element;
    const closestToolIndex = this._getClosestFreehandToolOnElement(
      element,
      eventData
    );

    if (closestToolIndex === undefined) {
      return;
    }

    config.currentTool = closestToolIndex;
    hideToolCursor(element);
  }

  /**
   * Activate the selected freehand tool and deactivate others.
   *
   * @private
   * @param {Object} element - The parent element of the freehand tool.
   * @param {Number} toolIndex - The ID of the freehand tool.
   * @returns {void}
   */
  _activateFreehandTool(element, toolIndex) {
    const toolState = getToolState(element, this.referencedToolName);
    const data = toolState.data;
    const config = this.configuration;

    config.currentTool = toolIndex;

    for (let i = 0; i < data.length; i++) {
      if (i === toolIndex) {
        data[i].active = true;
      } else {
        data[i].active = false;
      }
    }
  }

  /**
   * Choose the tool radius from the mouse position relative to the active freehand
   * tool, and begin sculpting.
   *
   * @private
   * @param {Object} eventData - Data object associated with the event.
   * @returns {void}
   */
  _initialiseSculpting(eventData) {
    const element = eventData.element;
    const config = this.configuration;

    this._active = true;

    // Interupt event dispatcher
    state.isMultiPartToolActive = true;

    this._configureToolSize(eventData);
    this._getMouseLocation(eventData);

    this._activateFreehandTool(element, config.currentTool);
    this._activateSculpt(element);
  }

  /**
   * Sculpts the freehand ROI with the circular freehandSculpter tool, moving,
   * adding and removing handles as necessary.
   *
   * @private
   * @param {Object} eventData - Data object associated with the event.
   * @param {Object} points - Array of points.
   * @returns {void}
   */
  _sculpt(eventData, points) {
    const config = this.configuration;

    this._sculptData = {
      element: eventData.element,
      image: eventData.image,
      mousePoint: eventData.currentPoints.image,
      points,
      toolSize: this._toolSizeImage,
      minSpacing: config.minSpacing,
      maxSpacing: Math.max(this._toolSizeImage, config.minSpacing * 2),
    };

    // Push existing handles radially away from tool.
    const pushedHandles = this._pushHandles();
    // Insert new handles in sparsely populated areas of the
    // Pushed part of the contour.

    if (pushedHandles.first !== undefined) {
      this._insertNewHandles(pushedHandles);
      // If any handles have been pushed very close together or even overlap,
      // Combine these into a single handle.
      this._consolidateHandles();
    }
  }

  /**
   * _pushHandles -Pushes the points radially away from the mouse if they are
   * contained within the circle defined by the freehandSculpter's toolSize and
   * the mouse position.
   *
   * @returns {Object}  The first and last pushedHandles.
   */
  _pushHandles() {
    const { points, mousePoint, toolSize } = this._sculptData;
    const pushedHandles = {};

    for (let i = 0; i < points.length; i++) {
      const distanceToHandle = external.cornerstoneMath.point.distance(
        points[i],
        mousePoint
      );

      if (distanceToHandle > toolSize) {
        continue;
      }

      // Push point if inside circle, to edge of circle.
      this._pushOneHandle(i, distanceToHandle);
      if (pushedHandles.first === undefined) {
        pushedHandles.first = i;
        pushedHandles.last = i;
      } else {
        pushedHandles.last = i;
      }
    }

    return pushedHandles;
  }

  /**
   * Pushes one handle.
   *
   * @private
   * @param {number} i - The index of the handle to push.
   * @param {number} distanceToHandle - The distance between the mouse cursor and the handle.
   * @returns {void}
   */
  _pushOneHandle(i, distanceToHandle) {
    const { points, mousePoint, toolSize, image } = this._sculptData;
    const handle = points[i];

    const directionUnitVector = {
      x: (handle.x - mousePoint.x) / distanceToHandle,
      y: (handle.y - mousePoint.y) / distanceToHandle,
    };

    const position = {
      x: mousePoint.x + toolSize * directionUnitVector.x,
      y: mousePoint.y + toolSize * directionUnitVector.y,
    };

    clipToBox(position, image);

    handle.x = position.x;
    handle.y = position.y;

    // Push lines
    const lastHandleIndex = this.constructor._getPreviousHandleIndex(
      i,
      points.length
    );

    points[lastHandleIndex].lines.pop();
    points[lastHandleIndex].lines.push(handle);
  }

  /**
   * Inserts additional handles in sparsely sampled regions of the contour. The
   * new handles are placed on the circle defined by the the freehandSculpter's
   * toolSize and the mouse position.
   * @private
   * @param {Array} pushedHandles
   * @returns {void}
   */
  _insertNewHandles(pushedHandles) {
    const indiciesToInsertAfter = this._findNewHandleIndicies(pushedHandles);
    let newIndexModifier = 0;

    for (let i = 0; i < indiciesToInsertAfter.length; i++) {
      const insertIndex = indiciesToInsertAfter[i] + 1 + newIndexModifier;

      this._insertHandleRadially(insertIndex);
      newIndexModifier++;
    }
  }

  /**
   * Returns an array of indicies that describe where new handles should be
   * inserted (where the distance between subsequent handles is >
   * config.maxSpacing).
   *
   * @private
   * @param {Object} pushedHandles - The first and last handles that were pushed.
   * @returns {Object} An array of indicies that describe where new handles should be inserted.
   */
  _findNewHandleIndicies(pushedHandles) {
    const { points, maxSpacing } = this._sculptData;
    const indiciesToInsertAfter = [];

    for (let i = pushedHandles.first; i <= pushedHandles.last; i++) {
      this._checkSpacing(i, points, indiciesToInsertAfter, maxSpacing);
    }

    const pointAfterLast = this.constructor._getNextHandleIndex(
      pushedHandles.last,
      points.length
    );

    // Check points before and after those pushed.
    if (pointAfterLast !== pushedHandles.first) {
      this._checkSpacing(
        pointAfterLast,
        points,
        indiciesToInsertAfter,
        maxSpacing
      );

      const pointBeforeFirst = this.constructor._getPreviousHandleIndex(
        pushedHandles.first,
        points.length
      );

      if (pointBeforeFirst !== pointAfterLast) {
        this._checkSpacing(
          pointBeforeFirst,
          points,
          indiciesToInsertAfter,
          maxSpacing
        );
      }
    }

    return indiciesToInsertAfter;
  }

  /**
   * _checkSpacing - description
   *@modifies indiciesToInsertAfter
   *
   * @param {number} i - The index to check.
   * @param {Object} points - The points.
   * @param {Array} indiciesToInsertAfter - The working list of indicies to insert new points after.
   * @param {number} maxSpacing
   * @returns {void}
   */
  _checkSpacing(i, points, indiciesToInsertAfter, maxSpacing) {
    const nextHandleIndex = this.constructor._getNextHandleIndex(
      i,
      points.length
    );

    const distanceToNextHandle = external.cornerstoneMath.point.distance(
      points[i],
      points[nextHandleIndex]
    );

    if (distanceToNextHandle > maxSpacing) {
      indiciesToInsertAfter.push(i);
    }
  }

  /**
   * Inserts a handle on the surface of the circle defined by toolSize and the
   * mousePoint.
   *
   * @private
   * @param {number} insertIndex - The index to insert the new handle.
   * @returns {void}
   */
  _insertHandleRadially(insertIndex) {
    const { points } = this._sculptData;

    const previousIndex = insertIndex - 1;
    const nextIndex = this.constructor._getNextHandleIndexBeforeInsert(
      insertIndex,
      points.length
    );
    const insertPosition = this._getInsertPosition(
      insertIndex,
      previousIndex,
      nextIndex
    );
    const handleData = new FreehandHandleData(insertPosition);

    points.splice(insertIndex, 0, handleData);

    // Add the line from the previous handle to the inserted handle (note the tool is now one increment longer)
    points[previousIndex].lines.pop();
    points[previousIndex].lines.push(points[insertIndex]);

    freehandUtils.addLine(points, insertIndex);
  }

  /**
   * Checks for any close points and consolidates these to a
   * single point.
   *
   * @private
   * @returns {void}
   */
  _consolidateHandles() {
    const { points } = this._sculptData;

    // Don't merge handles if it would destroy the polygon.
    if (points.length <= 3) {
      return;
    }

    const closePairs = this._findCloseHandlePairs();

    this._mergeCloseHandles(closePairs);
  }

  /**
   * Finds pairs of close handles with seperations < config.minSpacing. No handle
   * is included in more than one pair, to avoid spurious deletion of densely
   * populated regions of the contour (see mergeCloseHandles).
   *
   * @private
   * @returns {Array} An array of close pairs in points.
   */
  _findCloseHandlePairs() {
    const { points, minSpacing } = this._sculptData;
    const closePairs = [];
    let length = points.length;

    for (let i = 0; i < length; i++) {
      const nextHandleIndex = this.constructor._getNextHandleIndex(
        i,
        points.length
      );

      const distanceToNextHandle = external.cornerstoneMath.point.distance(
        points[i],
        points[nextHandleIndex]
      );

      if (distanceToNextHandle < minSpacing) {
        const pair = [i, nextHandleIndex];

        closePairs.push(pair);

        // Don't check last node if first in pair to avoid double counting.
        if (i === 0) {
          length -= 1;
        }

        // Don't double count pairs in order to prevent your polygon collapsing to a singularity.
        i++;
      }
    }

    return closePairs;
  }

  /**
   * Merges points given a list of close pairs. The points are merged in an
   * iterative fashion to prevent generating a singularity in some edge cases.
   *
   * @private
   * @param {Array} closePairs - An array of pairs of handle indicies.
   * @returns {void}
   */
  _mergeCloseHandles(closePairs) {
    let removedIndexModifier = 0;

    for (let i = 0; i < closePairs.length; i++) {
      const pair = this.constructor._getCorrectedPair(
        closePairs[i],
        removedIndexModifier
      );

      this._combineHandles(pair);
      removedIndexModifier++;
    }

    // Recursively remove problem childs
    const newClosePairs = this._findCloseHandlePairs();

    if (newClosePairs.length) {
      this._mergeCloseHandles(newClosePairs);
    }
  }

  /**
   * Combines two handles defined by the indicies in handlePairs.
   *
   * @private
   * @param {Object} handlePair - A pair of handle indicies.
   * @returns {void}
   */
  _combineHandles(handlePair) {
    const { points, image } = this._sculptData;

    // Calculate combine position: half way between the handles.
    const midPoint = {
      x: (points[handlePair[0]].x + points[handlePair[1]].x) / 2.0,
      y: (points[handlePair[0]].y + points[handlePair[1]].y) / 2.0,
    };

    clipToBox(midPoint, image);

    // Move first point to midpoint
    points[handlePair[0]].x = midPoint.x;
    points[handlePair[0]].y = midPoint.y;

    // Link first point to handle that second point links to.
    const handleAfterPairIndex = this.constructor._getNextHandleIndex(
      handlePair[1],
      points.length
    );

    points[handlePair[0]].lines.pop();
    points[handlePair[0]].lines.push(points[handleAfterPairIndex]);

    // Remove the latter handle
    points.splice(handlePair[1], 1);
  }

  /**
   * Calculates the distance to the closest handle in the tool, and stores the
   * result in this._toolSizeImage and this._toolSizeCanvas.
   *
   * @private
   * @param {Object} eventData - Data object associated with the event.
   * @returns {void}
   */
  _configureToolSize(eventData) {
    const element = eventData.element;
    const config = this.configuration;
    const toolIndex = config.currentTool;
    const coords = eventData.currentPoints.image;

    const toolState = getToolState(element, this.referencedToolName);
    const data = toolState.data[toolIndex];

    const freehandMouseTool = getToolForElement(
      element,
      this.referencedToolName
    );

    let radiusImage = freehandMouseTool.distanceFromPoint(
      element,
      data,
      coords
    );
    let radiusCanvas = freehandMouseTool.distanceFromPointCanvas(
      element,
      data,
      coords
    );

    // Check if should limit maximum size.
    if (config.limitRadiusOutsideRegion) {
      radiusImage = this._limitCursorRadiusImage(eventData, radiusImage);
      radiusCanvas = this._limitCursorRadiusCanvas(eventData, radiusCanvas);
    }

    this._toolSizeImage = radiusImage;
    this._toolSizeCanvas = radiusCanvas;
  }

  /**
   * Gets the current mouse location and stores it in the configuration object.
   *
   * @private
   * @param {Object} eventData - The data assoicated with the event.
   * @returns {void}
   */
  _getMouseLocation(eventData) {
    const config = this.configuration;

    config.mouseLocation.handles.start.x = eventData.currentPoints.image.x;
    config.mouseLocation.handles.start.y = eventData.currentPoints.image.y;
    clipToBox(config.mouseLocation.handles.start, eventData.image);
  }

  /**
   * Attaches event listeners to the element such that is is visible, modifiable, and new data can be created.
   *
   * @private
   * @param {Object} element - The viewport element to attach event listeners to.
   * @modifies {element}
   * @returns {void}
   */
  _activateSculpt(element) {
    this._deactivateSculpt(element);

    // Begin activeMouseDragCallback loop - call activeMouseUpCallback at end of drag or straight away if just a click.
    element.addEventListener(EVENTS.MOUSE_UP, this.activeMouseUpCallback);
    element.addEventListener(EVENTS.MOUSE_CLICK, this.activeMouseUpCallback);
    element.addEventListener(EVENTS.MOUSE_DRAG, this.activeMouseDragCallback);

    external.cornerstone.updateImage(element);
  }

  /**
   * Removes event listeners from the element.
   *
   * @private
   * @param {Object} element - The viewport element to remove event listeners from.
   * @modifies {element}
   * @returns {void}
   */
  _deactivateSculpt(element) {
    element.removeEventListener(EVENTS.MOUSE_UP, this.activeMouseUpCallback);
    element.removeEventListener(EVENTS.MOUSE_CLICK, this.activeMouseUpCallback);
    element.removeEventListener(
      EVENTS.MOUSE_DRAG,
      this.activeMouseDragCallback
    );

    external.cornerstone.updateImage(element);
  }

  /**
   * Invalidate the freehand tool data, tirggering re-calculation of statistics.
   *
   * @private
   * @param {Object} eventData - Data object associated with the event.
   * @returns {void}
   */
  _invalidateToolData(eventData) {
    const config = this.configuration;
    const element = eventData.element;
    const toolData = getToolState(element, this.referencedToolName);
    const data = toolData.data[config.currentTool];

    data.invalidated = true;
  }

  /**
   * Deactivates all freehand ROIs and change currentTool to null
   *
   * @private
   * @param {Object} evt - The event.
   * @returns {void}
   */
  // eslint-disable-next-line no-unused-vars
  _deselectAllTools(evt) {
    const config = this.configuration;
    const toolData = getToolState(this.element, this.referencedToolName);

    config.currentTool = null;

    if (toolData) {
      for (let i = 0; i < toolData.data.length; i++) {
        toolData.data[i].active = false;
      }
    }

    setToolCursor(this.element, this.svgCursor);

    external.cornerstone.updateImage(this.element);
  }

  /**
   * Given a pair of indicies, and the number of points already removed,
   * convert to the correct live indicies.
   *
   * @private
   * @static
   * @param {Object} pair A pairs of handle indicies.
   * @param {Number} removedIndexModifier The number of handles already removed.
   * @returns {Object} The corrected pair of handle indicies.
   */
  static _getCorrectedPair(pair, removedIndexModifier) {
    const correctedPair = [
      pair[0] - removedIndexModifier,
      pair[1] - removedIndexModifier,
    ];

    // Deal with edge case of last node + first node.
    if (correctedPair[1] < 0) {
      correctedPair[1] = 0;
    }

    return correctedPair;
  }

  /**
   * Limits the cursor radius so that it its maximum area is the same as the
   * ROI being sculpted (in canvas coordinates).
   *
   * @private
   * @param  {Object}  eventData    Data object associated with the event.
   * @param  {Number}  radiusCanvas The distance from the mouse to the ROI
   *                                in canvas coordinates.
   * @returns {Number}              The limited radius in canvas coordinates.
   */
  _limitCursorRadiusCanvas(eventData, radiusCanvas) {
    return this._limitCursorRadius(eventData, radiusCanvas, true);
  }

  /**
   * Limits the cursor radius so that it its maximum area is the same as the
   * ROI being sculpted (in image coordinates).
   *
   * @private
   * @param  {Object}  eventData    Data object associated with the event.
   * @param  {Number}  radiusImage  The distance from the mouse to the ROI
   *                                in image coordinates.
   * @returns {Number}              The limited radius in image coordinates.
   */
  _limitCursorRadiusImage(eventData, radiusImage) {
    return this._limitCursorRadius(eventData, radiusImage, false);
  }

  /**
   * Limits the cursor radius so that it its maximum area is the same as the
   * ROI being sculpted.
   *
   * @private
   * @param  {Object}  eventData    Data object associated with the event.
   * @param  {Number}  radius       The distance from the mouse to the ROI.
   * @param  {Boolean} canvasCoords Whether the calculation should be performed
   *                                In canvas coordinates.
   * @returns {Number}              The limited radius.
   */
  _limitCursorRadius(eventData, radius, canvasCoords = false) {
    const element = eventData.element;
    const image = eventData.image;
    const config = this.configuration;

    const toolState = getToolState(element, this.referencedToolName);
    const data = toolState.data[config.currentTool];

    let areaModifier = 1.0;

    if (canvasCoords) {
      const topLeft = external.cornerstone.pixelToCanvas(element, {
        x: 0,
        y: 0,
      });
      const bottomRight = external.cornerstone.pixelToCanvas(element, {
        x: image.width,
        y: image.height,
      });
      const canvasArea =
        (bottomRight.x - topLeft.x) * (bottomRight.y - topLeft.y);

      areaModifier = canvasArea / (image.width * image.height);
    }

    const area = data.area * areaModifier;
    const maxRadius = Math.pow(area / Math.PI, 0.5);

    return Math.min(radius, maxRadius);
  }

  /**
   * Finds the nearest handle to the mouse cursor for all freehand
   * data on the element.
   *
   * @private
   * @param {Object} element - The element.
   * @param {Object} eventData - Data object associated with the event.
   * @returns {Number} The tool index of the closest freehand tool.
   */
  _getClosestFreehandToolOnElement(element, eventData) {
    const freehand = getToolForElement(element, this.referencedToolName);
    const toolState = getToolState(element, this.referencedToolName);

    if (!toolState) {
      return;
    }

    const data = toolState.data;
    const pixelCoords = eventData.currentPoints.image;

    const closest = {
      distance: Infinity,
      toolIndex: null,
    };

    for (let i = 0; i < data.length; i++) {
      const distanceFromToolI = freehand.distanceFromPoint(
        element,
        data[i],
        pixelCoords
      );

      if (distanceFromToolI === -1) {
        continue;
      }

      if (distanceFromToolI < closest.distance) {
        closest.distance = distanceFromToolI;
        closest.toolIndex = i;
      }
    }

    return closest.toolIndex;
  }

  /**
   * Returns the next handle index.
   *
   * @private
   * @static
   * @param {Number} i - The handle index.
   * @param {Number} length - The length of the polygon.
   * @returns {Number} The next handle index.
   */
  static _getNextHandleIndex(i, length) {
    if (i === length - 1) {
      return 0;
    }

    return i + 1;
  }

  /**
   * Returns the previous handle index.
   *
   * @private
   * @static
   * @param {Number} i - The handle index.
   * @param {Number} length - The length of the polygon.
   * @returns {Number} The previous handle index.
   */
  static _getPreviousHandleIndex(i, length) {
    if (i === 0) {
      return length - 1;
    }

    return i - 1;
  }

  /**
   * Returns the next handle index, with a correction considering a handle is
   * about to be inserted.
   *
   * @private
   * @static
   * @param {Number} insertIndex - The index in which the handle is being inserted.
   * @param {Number} length - The length of the polygon.
   * @returns {Number} The next handle index.
   */
  static _getNextHandleIndexBeforeInsert(insertIndex, length) {
    if (insertIndex === length) {
      return 0;
    }
    // Index correction here: The line bellow is correct, as we haven't inserted our handle yet!

    return insertIndex;
  }

  /**
   * Calculates the position that a new handle should be inserted.
   *
   * @private
   * @static
   * @param {Number} insertIndex - The index to insert the new handle.
   * @param {Number} previousIndex - The previous index.
   * @param {Number} nextIndex - The next index.
   * @returns {Object} The position the handle should be inserted.
   */
  _getInsertPosition(insertIndex, previousIndex, nextIndex) {
    const { points, toolSize, mousePoint, image } = this._sculptData;

    // Calculate insert position: half way between the handles, then pushed out
    // Radially to the edge of the freehandSculpter.
    const midPoint = {
      x: (points[previousIndex].x + points[nextIndex].x) / 2.0,
      y: (points[previousIndex].y + points[nextIndex].y) / 2.0,
    };

    const distanceToMidPoint = external.cornerstoneMath.point.distance(
      mousePoint,
      midPoint
    );

    let insertPosition;

    if (distanceToMidPoint < toolSize) {
      const directionUnitVector = {
        x: (midPoint.x - mousePoint.x) / distanceToMidPoint,
        y: (midPoint.y - mousePoint.y) / distanceToMidPoint,
      };

      insertPosition = {
        x: mousePoint.x + toolSize * directionUnitVector.x,
        y: mousePoint.y + toolSize * directionUnitVector.y,
      };
    } else {
      insertPosition = midPoint;
    }

    clipToBox(insertPosition, image);

    return insertPosition;
  }

  // ===================================================================
  // Public Configuration API. .
  // ===================================================================

  get minSpacing() {
    return this.configuration.minSpacing;
  }

  set minSpacing(value) {
    if (typeof value !== 'number') {
      throw new Error(
        'Attempting to set freehandSculpter minSpacing to a value other than a number.'
      );
    }

    this.configuration.minSpacing = value;
  }

  get maxSpacing() {
    return this.configuration.maxSpacing;
  }

  set maxSpacing(value) {
    if (typeof value !== 'number') {
      throw new Error(
        'Attempting to set freehandSculpter maxSpacing to a value other than a number.'
      );
    }

    this.configuration.maxSpacing = value;
  }

  get showCursorOnHover() {
    return this.configuration.showCursorOnHover;
  }

  set showCursorOnHover(value) {
    if (typeof value !== 'boolean') {
      throw new Error(
        'Attempting to set freehandSculpter showCursorOnHover to a value other than a boolean.'
      );
    }

    this.configuration.showCursorOnHover = value;
    external.cornerstone.updateImage(this.element);
  }

  get limitRadiusOutsideRegion() {
    return this.configuration.limitRadiusOutsideRegion;
  }

  set limitRadiusOutsideRegion(value) {
    if (typeof value !== 'boolean') {
      throw new Error(
        'Attempting to set freehandSculpter limitRadiusOutsideRegion to a value other than a boolean.'
      );
    }

    this.configuration.limitRadiusOutsideRegion = value;
    external.cornerstone.updateImage(this.element);
  }

  get hoverCursorFadeAlpha() {
    return this.configuration.hoverCursorFadeAlpha;
  }

  set hoverCursorFadeAlpha(value) {
    if (typeof value !== 'number') {
      throw new Error(
        'Attempting to set freehandSculpter hoverCursorFadeAlpha to a value other than a number.'
      );
    }

    // Clamp the value from 0 to 1.
    value = Math.max(Math.min(value, 1.0), 0.0);

    this.configuration.hoverCursorFadeAlpha = value;
    external.cornerstone.updateImage(this.element);
  }

  get hoverCursorFadeDistance() {
    return this.configuration.hoverCursorFadeDistance;
  }

  set hoverCursorFadeDistance(value) {
    if (typeof value !== 'number') {
      throw new Error(
        'Attempting to set freehandSculpter hoverCursorFadeDistance to a value other than a number.'
      );
    }

    // Don't allow to fade a distances smaller than the tool's radius.
    value = Math.max(value, 1.0);

    this.configuration.hoverCursorFadeDistance = value;
    external.cornerstone.updateImage(this.element);
  }
}

/**
 * Returns the default freehandSculpterMouseTool configuration.
 *
 * @returns {Object} The default configuration object.
 */
function getDefaultFreehandSculpterMouseToolConfiguration() {
  return {
    mouseLocation: {
      handles: {
        start: {
          highlight: true,
          active: true,
        },
      },
    },
    minSpacing: 1,
    currentTool: null,
    dragColor: toolColors.getActiveColor(),
    hoverColor: toolColors.getToolColor(),

    /* --- Hover options ---
    showCursorOnHover:        Shows a preview of the sculpting radius on hover.
    limitRadiusOutsideRegion: Limit max toolsize outside the subject ROI based
                              on subject ROI area.
    hoverCursorFadeAlpha:     Alpha to fade to when tool very distant from
                              subject ROI.
    hoverCursorFadeDistance:  Distance from ROI in which to fade the hoverCursor
                              (in units of radii).
    */
    showCursorOnHover: true,
    limitRadiusOutsideRegion: true,
    hoverCursorFadeAlpha: 0.5,
    hoverCursorFadeDistance: 1.2,
  };
}

function preventPropagation(evt) {
  evt.stopImmediatePropagation();
  evt.stopPropagation();
  evt.preventDefault();
}

const freehandSculpterCursor = {
  svgGroupString: `<g id="icon-freehand-sculpt" fill="none" stroke-width="1.5" stroke="ACTIVE_COLOR" stroke-linecap="round" stroke-linejoin="round">
      <line id="svg_1" y2="2.559367" x2="10.184807" y1="4.467781" x1="8.81711"/>
      <line id="svg_4" y2="1.493836" x2="11.727442" y1="2.766112" x1="10.089386"/>
      <line id="svg_7" y2="1.080346" x2="13.047428" y1="1.748291" x1="11.345759"/>
      <line id="svg_8" y2="1.000829" x2="14.351511" y1="1.112153" x1="12.77707"/>
      <line id="svg_9" y2="1.350705" x2="15.242104" y1="0.905408" x1="13.969828"/>
      <line id="svg_10" y2="2.098167" x2="15.862339" y1="1.14396" x1="14.955842"/>
      <line id="svg_11" y2="3.195505" x2="16.41896" y1="1.939133" x1="15.766918"/>
      <line id="svg_12" y2="4.292843" x2="16.530284" y1="2.925147" x1="16.387153"/>
      <line id="svg_16" y2="5.644637" x2="16.196311" y1="3.831643" x1="16.593898"/>
      <line id="svg_18" y2="7.266789" x2="15.623787" y1="5.19934" x1="16.275829"/>
      <line id="svg_19" y2="10.813258" x2="14.526449" y1="6.726071" x1="15.766918"/>
      <line id="svg_20" y2="5.056209" x2="8.085552" y1="4.181519" x1="8.976145"/>
      <line id="svg_23" y2="5.326568" x2="7.481221" y1="4.78585" x1="8.403621"/>
      <line id="svg_24" y2="5.565119" x2="6.749662" y1="5.294761" x1="7.624352"/>
      <line id="svg_25" y2="5.994512" x2="5.429675" y1="5.533312" x1="6.956407"/>
      <line id="svg_27" y2="6.551133" x2="4.284627" y1="5.962706" x1="5.572807"/>
      <line id="svg_28" y2="7.584858" x2="3.044158" y1="6.392099" x1="4.427758"/>
      <line id="svg_29" y2="8.84123" x2="2.185372" y1="7.489437" x1="3.219096"/>
      <line id="svg_31" y2="10.606513" x2="1.644654" y1="8.602678" x1="2.280792"/>
      <line id="svg_32" y2="13.214679" x2="1.48562" y1="10.352058" x1="1.724171"/>
      <line id="svg_33" y2="14.375631" x2="1.676461" y1="12.992031" x1="1.453813"/>
      <line id="svg_34" y2="15.298031" x2="2.264889" y1="14.152983" x1="1.517427"/>
      <line id="svg_35" y2="16.172721" x2="3.521261" y1="14.948155" x1="1.915013"/>
      <line id="svg_36" y2="16.824762" x2="5.207027" y1="15.997783" x1="3.28271"/>
      <line id="svg_38" y2="17.063314" x2="7.035924" y1="16.745245" x1="4.968475"/>
      <line id="svg_39" y2="16.888376" x2="9.278311" y1="17.047411" x1="6.733758"/>
      <line id="svg_40" y2="16.284045" x2="10.661911" y1="16.983797" x1="8.992048"/>
      <line id="svg_41" y2="15.313934" x2="11.647925" y1="16.395369" x1="10.455166"/>
      <line id="svg_44" y2="13.898527" x2="12.82478" y1="15.425259" x1="11.504794"/>
      <line id="svg_45" y2="12.037824" x2="14.144766" y1="14.312017" x1="12.522614"/>
      <line id="svg_47" y2="10.59061" x2="14.605966" y1="12.228665" x1="13.953925"/>
      <ellipse ry="1" rx="1" id="svg_48" cy="3.982726" cx="13.460918"/>
    </g>`,
  options: {
    viewBox: {
      x: 18,
      y: 18,
    },
  },
};
