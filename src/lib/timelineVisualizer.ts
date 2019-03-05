import { fabric } from 'fabric'
import * as isEqual from 'lodash.isequal'

import { Resolver, TimelineObject, ResolveOptions, ResolvedTimeline, ResolvedTimelineObjects, TimelineObjectInstance, ResolvedTimelineObject } from 'superfly-timeline'

/** Step size/ time step. */
const DEFAULT_STEP_SIZE = 1
/** Draw range (will be multiplied by DEFAULT_STEP_SIZE). */
const DEFAULT_DRAW_RANGE = 500
/** Width of label column. */
const LABEL_WIDTH_OF_TIMELINE = 0.25
/** Default zoom */
const DEFAULT_ZOOM_VALUE = 100
/** Factor to zoom by */
const ZOOM_FACTOR = 1.001
/** Factor to pan by (pan = PAN_FACTOR * STEP_SIZE) */
const PAN_FACTOR = 1

/** Maximum layer height */
const MAX_LAYER_HEIGHT = 60

/** Amount to move playhead per second. */
const DEFAULT_PLAYHEAD_SPEED = 1
/** Playhead fabric object name */
const NAME_PLAYHEAD = 'superfly-timeline:playhead'

/** BEGIN STYLING VALUES */

/** Timeline background color. */
const COLOR_BACKGROUND = '#333333'

/** Layer label background color. */
const COLOR_LABEL_BACKGROUND = '#666666'

/** Playhead color. */
const COLOR_PLAYHEAD = 'rgba(255, 0, 0, 0.5)'

/** Playhead thickness. */
const THICKNESS_PLAYHEAD = 5

/** Color of line separating timeline rows. */
const COLOR_LINE = 'black'
/** Height of line separating rows. */
const THICKNESS_LINE = 1

/** Text properties. */
const TEXT_FONT_FAMILY = 'Calibri'
const TEXT_FONT_SIZE = 16
const TEXT_COLOR = 'white'

/** Timeline object properties. */
const COLOR_TIMELINE_OBJECT_FILL = 'rgb(22, 102, 247, 0.75)'
const COLOR_TIMELINE_OBJECT_BORDER = 'rgba(232, 240, 255, 0.85)'
const THICKNESS_TIMELINE_OBJECT_BORDER = 1

/** Timeline object height as a proportion of the row height. */
const TIMELINE_OBJECT_HEIGHT = 0.8

/** END STYLING VALUES */

export interface TimelineDrawState {
	[id: string]: DrawState
}

export interface DrawState {
	width: number
	height: number
	left: number
	top: number
	visible: boolean
}

/**
 * Allows the viewort of the timeline to be set.
 */
export interface ViewPort {
	/** Timestamp to move the start of the timeline to. */
	timestamp?: number
	/** Factor to zoom in on the timeline. */
	zoom?: number
	/** Whether the playhead should be moving. */
	playPlayhead?: boolean
	/** Move the playhead to a specified time. */
	playheadTime: number
	/** Whether the viewport is playing */
	playViewPort?: boolean
	/** The speed to use when playing */
	playSpeed?: number
}

export interface TimelineVisualizerOptions {
	/** Whether to draw the playhead or not */
	drawPlayhead?: boolean
}
type Layers = {[layer: string]: number} // the content is the index/offset

/**
 * Stores the times to trim a timeline between.
 */
export interface TrimProperties {
	start?: number
	end?: number
}

/**
 * Stores the object currently being hovered over.
 */
export interface HoveredObject {
	object: TimelineObject,
	instance: TimelineObjectInstance,
	pointer: { xPostion: number, yPosition: number }
}

/**
 * Used when splitting up the name of a timeline object to separate out the data stored within the name.
 */
export interface TimelineObjectMetaData {
	type: string
	timelineIndex: number
	name: string
	instance: string
}

export class TimelineVisualizer {
	// Step size.
	public stepSize: number = DEFAULT_STEP_SIZE

	 /** @private @readonly Proportion of the canvas to be used for the layer labels column. */
	 private readonly _layerLabelWidthProportionOfCanvas = LABEL_WIDTH_OF_TIMELINE
	 /** @private @readonly Default time range to display. */
	private readonly _defaultDrawRange = DEFAULT_DRAW_RANGE * this.stepSize

	// Timelines currently drawn.
	private _resolvedTimelines: ResolvedTimeline[] = []
	// Layers on timeline.
	private _layerLabels: Layers = {}

	// Width of column of layer labels.
	private _layerLabelWidth: number

	// Canvas ID.
	private _canvasId: string
	// Canvas to draw to.
	private _canvas: fabric.Canvas

	// Width and height of the canvas, in pixels.
	private _canvasWidth: number
	private _canvasHeight: number

	// Height of a timeline row, in pixels.
	private _rowHeight: number

	// Width of the actual timeline within the canvas, in pixels.
	private _timelineWidth: number
	// Start and end of the timeline relative to the left of the canvas, in pixels.
	private _timelineStart: number

	// Height of objects to draw.
	private _timelineObjectHeight: number

	// Start and end time of the current view. Defines the objects within view on the timeline.
	private _drawTimeStart: number = 0
	private _drawTimeEnd: number
	// Current range of times to draw.
	private _drawTimeRange: number

	// Scaled timeline start and end, according to zoom.
	private _scaledDrawTimeRange: number

	// Width of an object per unit time of duration.
	private _pixelsWidthPerUnitTime: number

	// Store whether the mouse is held down, for scrolling.
	private _mouseDown: boolean = false

	// Last x positions of the mouse cursor (on click and on drag), for scrolling.
	private _mouseLastX: number

	// Last direction the user moved on the timeline, helps to smooth changing scroll direction.
	private _lastScrollDirection: number

	// Current zoom amount.
	private _timelineZoom: number = DEFAULT_ZOOM_VALUE

	// List of fabric objects created.
	private _fabricObjects: string[] = []

	// List of fabric objects created for layers.
	private _layerFabricObjects: string[] = []

	// Whether or not the playhead should move.
	private _playHeadPlaying: boolean = false

	// Whether or not the viewport should move
	private _playViewPort: boolean

	// Whether to draw the playhead or not
	private _drawPlayhead: boolean
	// Speed of the playhead [units / second]
	private _playSpeed: number = DEFAULT_PLAYHEAD_SPEED
	// The current time position of the playhead.
	private _playHeadTime: number = 0
	// The playhead position in canvas coordinates.
	private _playHeadPosition: number

	// The last time updateDraw() did a draw.
	private _updateDrawLastTime: number = 0

	// The object currently being hovered over.
	private _hoveredOver: HoveredObject | undefined

	/**
	 * @param {string} canvasId The ID of the canvas object to draw within.
	 */
	constructor (canvasId: string, options: TimelineVisualizerOptions = {}) {
		// Initialise other values.
		this._canvasId = canvasId

		this.initCanvas()

		this._drawPlayhead = !!options.drawPlayhead

		// Calculate width of label column.
		this._layerLabelWidth = this._canvasWidth * this._layerLabelWidthProportionOfCanvas

		// Calculate timeline width and start point.
		this._timelineWidth = this._canvasWidth - this._layerLabelWidth
		this._timelineStart = this._layerLabelWidth

		// Put playhead at timeline start.
		this._playHeadPosition = this._timelineStart

		// Draw background.
		let background = new fabric.Rect({
			left: 0,
			top: 0,
			fill: COLOR_BACKGROUND,
			width: this._canvasWidth,
			height: this._canvasHeight,
			selectable: false,
			name: 'background'
		})
		this._canvas.add(background)

		// If the playhead should be draw.
		if (this._drawPlayhead) {
			// Draw playhead.
			let playhead = new fabric.Rect({
				left: this._playHeadPosition,
				top: 0,
				fill: COLOR_PLAYHEAD,
				width: THICKNESS_PLAYHEAD,
				height: this._canvasHeight,
				selectable: false,
				name: NAME_PLAYHEAD
			})
			this._canvas.add(playhead)

			// Bring playhead to front.
			this._canvas.getObjects().forEach(element => {
				if (element.name === NAME_PLAYHEAD) {
					element.bringToFront()
				}
			})
			// Tell canvas to re-render all objects.
			this._canvas.renderAll()

		}
		this.updateDraw()
	}

	/**
	 * Initialises the canvas and registers canvas events.
	 */
	initCanvas () {
		// Create new canvas object.
		this._canvas = new fabric.Canvas(this._canvasId)

		if (!this._canvas) throw new Error(`Canvas "${this._canvasId}" not found`)

		// Disable group selection.
		this._canvas.selection = false
		// Set cursor.
		this._canvas.hoverCursor = 'default'

		// Register canvas interaction event handlers.
		this._canvas.on('mouse:down', event => this.canvasMouseDown(event))
		this._canvas.on('mouse:up', event => this.canvasMouseUp(event))
		this._canvas.on('mouse:move', event => this.canvasMouseMove(event))
		this._canvas.on('mouse:wheel', event => this.canvasScrollWheel(event))
		this._canvas.on('mouse:over', event => this.canvasObjectHover(event, true))
		this._canvas.on('mouse:out', event => this.canvasObjectHover(event, false))

		// Get width and height of canvas.
		this._canvasWidth = this._canvas.getWidth()
		this._canvasHeight = this._canvas.getHeight()
	}

	/**
	 * Sets the timeline to draw.
	 * @param {TimelineObject[]} timeline Timeline to draw.
	 * @param {ResolveOptions} options Options to use for resolving timeline state.
	 */
	setTimeline (timeline: TimelineObject[], options: ResolveOptions) {
		// Resolve timeline.
		const resolvedTimeline = Resolver.resolveTimeline(timeline, options)

		// Save the resolved timeline:
		this._resolvedTimelines = [resolvedTimeline]

		// Get layers to draw.
		// const o = this.getLayersToDraw()
		// this._layerLabels = o.layers

		// Calculate height of rows based on number of layers.
		// this._rowHeight = this.calculateRowHeight(this._layerLabels)

		// Draw the layer labels.
		this.drawLayerLabels()

		this.drawInitialTimeline(resolvedTimeline, options)
	}

	/**
	 * Updates the timeline, should be called when actions are added/removed from a timeline
	 * but the same timeline is being drawn.
	 * @param {TimelineObject[]} timeline Timeline to draw.
	 * @param {ResolveOptions} options Resolve options.
	 */
	updateTimeline (timeline: TimelineObject[], options?: ResolveOptions) {
		// If options have not been specified set time to 0.
		if (options === undefined) {
			options = {
				time: 0
			}
		}
		if (this._resolvedTimelines.length === 0) {
			// There are no previous timelines, run setTimeline instead:
			return this.setTimeline(timeline, options)
		}

		// If the playhead is being drawn, the resolve time should be at the playhead time.
		if (this._drawPlayhead) {
			options.time = this._playHeadTime
		}

		// Resolve the timeline.
		let resolvedTimeline = Resolver.resolveTimeline(timeline, options)

		for (let _i = 0; _i < this._resolvedTimelines.length; _i++) {
			let currentState = this.getTimelineDrawState(this._resolvedTimelines[_i], _i)

			this.hideTimelineFabricObjects(currentState)
		}

		// If we're using the playhead, trim the timeline.
		if (this._drawPlayhead) {
			resolvedTimeline = this.trimTimeline(resolvedTimeline, { start: this._playHeadTime })

			let currentTimeline = this._resolvedTimelines[this._resolvedTimelines.length - 1]
			// Trim the current timeline:
			if (currentTimeline) {
				currentTimeline = this.trimTimeline(
					currentTimeline,
					{ end: this._playHeadTime }
				)

				// Merge the timelines.
				let mergedTimelines = this.mergeTimelineObjects(currentTimeline, resolvedTimeline)

				// save the updated timeline to
				this._resolvedTimelines[this._resolvedTimelines.length - 1] = mergedTimelines.past
				resolvedTimeline = mergedTimelines.present

			}

			// Store the resolved timeline at a new spot:
			this._resolvedTimelines.push(resolvedTimeline)

			// let newLayers = this.getLayersToDraw()

			// if (newLayers.length !== this._layerLabels.length) {
			// }
			this.drawLayerLabels()

			// Create new fabric objects for new objects in timeline.
			this.createTimelineFabricObjects(resolvedTimeline.objects, this._resolvedTimelines.length - 1)
		} else {
			// Otherwise we only see one timeline at a time.

			// Overwrite the previous timeline:
			this._resolvedTimelines[this._resolvedTimelines.length - 1] = resolvedTimeline

			// let newLayers = this.getLayersToDraw()

			// if (newLayers.length !== this._layerLabels.length) {
			// }
			this.drawLayerLabels()

			// Create new fabric objects for new objects in timeline.
			this.createTimelineFabricObjects(resolvedTimeline.objects, this._resolvedTimelines.length - 1)
		}

		// Draw timeline.
		this.redrawTimeline()
	}

	/**
	 * Sets the viewport to a position, zoom, and playback speed.
	 * Playback speed currently not implemented.
	 * @param viewPort Object to update viewport with.
	 */
	setViewPort (viewPort: ViewPort) {
		// Whether the viewport has changed.
		let changed = false

		// If zoom has been specified.
		if (viewPort.zoom !== undefined) {
			// Zoom to specified zoom.
			this._timelineZoom = viewPort.zoom
			this.updateScaledDrawTimeRange()
			this._drawTimeEnd = this._timelineStart + this._scaledDrawTimeRange
			changed = true
		}

		// If timestamp has been specified.
		if (viewPort.timestamp !== undefined) {
			// Set start time to specified time.
			if (viewPort.timestamp > 0) {
				this._drawTimeStart = viewPort.timestamp
				this._drawTimeEnd = this._drawTimeStart + this._scaledDrawTimeRange

				changed = true
			}
		}

		if (viewPort.playViewPort !== undefined) {
			this._playViewPort = viewPort.playViewPort
		}

		// If the playback speed has been set, set the new playback speed.
		if (viewPort.playSpeed !== undefined) {
			if (!this._drawPlayhead) throw new Error('setViewPort: viewPort.playSpeed was set, but drawPlayhead was not set in constructor')
			this._playSpeed = viewPort.playSpeed
		}

		// Set playhead playing/ not playing.
		if (viewPort.playPlayhead !== undefined) {
			if (!this._drawPlayhead) throw new Error('setViewPort: viewPort.playPlayhead was set, but drawPlayhead was not set in constructor')
			this._playHeadPlaying = viewPort.playPlayhead
		}

		if (viewPort.playheadTime !== undefined) {
			if (!this._drawPlayhead) throw new Error('setViewPort: viewPort.playheadTime was set, but drawPlayhead was not set in constructor')
			this._playHeadTime = Math.max(0, viewPort.playheadTime)
			changed = true
		}

		// Redraw timeline if anything has changed.
		if (changed === true) {
			this.computePlayheadPosition()

			this.redrawTimeline()
		}
	}

	/**
	 * Accessor for polling the currently hovered over object.
	 */
	getHoveredObject() {
		return this._hoveredOver
	}

	/**
	 * Calculates the height to give to each row to fit all layers on screen.
	 * @param {String[]} layers Map of layers to use.
	 * @returns Height of rows.
	 */
	calculateRowHeight (layers: Layers): number {
		return Math.min(MAX_LAYER_HEIGHT, this._canvasHeight / Object.keys(layers).length)
	}

	/**
	 * Draws the layer labels to the canvas.
	 */
	drawLayerLabels () {
		// Store layers to draw.
		const o = this.getLayersToDraw()

		if (!isEqual(this._layerLabels, o.layers)) {

			this._layerLabels = o.layers

			// Calculate row height.
			this._rowHeight = this.calculateRowHeight(this._layerLabels)

			// Set timeline object height.
			this._timelineObjectHeight = this._rowHeight * TIMELINE_OBJECT_HEIGHT

			// Iterate through layers.
			for (let _i = 0; _i < o.layersArray.length; _i++) {
				if (this._layerFabricObjects.indexOf(o.layersArray[_i]) === -1) {
					// Create a background rectangle.
					let layerRect = new fabric.Rect({
						left: 0,
						top: _i * this._rowHeight,
						fill: COLOR_LABEL_BACKGROUND,
						width: this._layerLabelWidth,
						height: this._rowHeight,
						selectable: false,
						name: 'Layer:Rect:' + o.layersArray[_i]
					})

					// Create label.
					let layerText = new fabric.Text(o.layersArray[_i], {
						width: this._layerLabelWidth,
						fontFamily: TEXT_FONT_FAMILY,
						fontSize: TEXT_FONT_SIZE,
						textAlign: 'left',
						fill: TEXT_COLOR,
						selectable: false,
						top: (_i * this._rowHeight) + (this._rowHeight / 2),
						name: 'Layer:Text:' + o.layersArray[_i]
					})

					// If this is the topmost label, draw to screen.
					// Otherwise, add a line between rows.
					if (_i === 0) {
						// Draw.
						this._canvas.add(layerRect)
						this._canvas.add(layerText)
					} else {
						// Create line.
						let layerLine = new fabric.Rect({
							left: this._layerLabelWidth,
							top: _i * this._rowHeight,
							fill: COLOR_LINE,
							width: this._timelineWidth,
							height: THICKNESS_LINE,
							selectable: false,
							name: 'Layer:Line:' + o.layersArray[_i]
						})

						// Draw.
						this._canvas.add(layerRect)
						this._canvas.add(layerText)
						this._canvas.add(layerLine)
					}

					this._layerFabricObjects.push(o.layersArray[_i])
				}
			}

			this._canvas.getObjects().forEach(element => {
				if (element.name !== undefined) {
					let name = (element.name as string).split(':')
					if (name[0] === 'Layer') {
						let offset = this._layerLabels[name[2]]
						if (offset === undefined) offset = -1

						if (name[1] === 'Rect') {
							element.set({
								top: offset * this._rowHeight,
								height: this._rowHeight,
							})
						} else if (name[1] === 'Text') {
							element.set({
								top: (offset * this._rowHeight) - (TEXT_FONT_SIZE / 2) + (this._rowHeight / 2),
							})
						} else if (name[1] === 'Line') {
							element.set({
								top: offset * this._rowHeight,
							})
						}
					}
				}
			})

			this._canvas.renderAll()
		}
	}

	getLayersToDraw () {
		let layersArray: string[] = []

		for (let _i = 0; _i < this._resolvedTimelines.length; _i++) {
			for (let _j = 0; _j < Object.keys(this._resolvedTimelines[_i].layers).length; _j++) {
				let layer: string = Object.keys(this._resolvedTimelines[_i].layers)[_j]

				if (layersArray.indexOf(layer) === -1) {
					layersArray.push(layer)
				}
			}
		}

		layersArray = layersArray.sort((a, b) => {
			if (a > b) return 1
			if (a < b) return -1
			return 0
		})

		let layers: Layers = {}

		layersArray.forEach((layerName, index) => {
			layers[layerName] = index
		})

		return {
			layers: layers,
			layersArray: layersArray
		}
	}

	/**
	 * Draws the timeline initially.
	 * @param {ResolvedTimeline} timeline Timeline to draw.
	 * @param {ResolveOptions} options Resolve options.
	 */
	drawInitialTimeline (timeline: ResolvedTimeline, options: ResolveOptions) {
		// Set time range.
		this._drawTimeRange = this._defaultDrawRange

		// Calculate new zoom values.
		this.updateScaledDrawTimeRange()

		// Set timeline start and end times.
		if (options.time !== undefined) {
			this._drawTimeStart = options.time
		}
		this._drawTimeEnd = this._drawTimeStart + this._scaledDrawTimeRange

		// Move playhead to start time.
		this._playHeadTime = this._drawTimeStart

		// Create fabric objects for all time-based objects.
		this.createTimelineFabricObjects(timeline.objects, 0)

		// Draw timeline.
		this.redrawTimeline()
	}

	/**
	 * Redraws the timeline to the canvas.
	 */
	redrawTimeline () {
		// Calculate how many pixels are required per unit time.
		this._pixelsWidthPerUnitTime = this._timelineWidth / (this._drawTimeEnd - this._drawTimeStart)

		// Draw each resolved timeline.

		let timeLineState: TimelineDrawState = {}
		for (let _i = 0; _i < this._resolvedTimelines.length; _i++) {
			let ts = this.getTimelineDrawState(this._resolvedTimelines[_i], _i)
			Object.keys(ts).forEach(id => {
				timeLineState[id] = ts[id]
			})
		}
		// Draw the current state.
		this.drawTimelineState(timeLineState)

		// Find new playhead position.
		this.computePlayheadPosition()

		// Redraw the playhead.
		this.redrawPlayHead()
	}

	/**
	 * Draws the playhead on the canvas.
	 */
	redrawPlayHead () {
		// Check playhead should be drawn.
		if (this._drawPlayhead) {
			let left = this._playHeadPosition
			let height = this._canvasHeight
			let width = THICKNESS_PLAYHEAD

			if (left === -1) {
				left = 0
				height = 0
				width = 0
			}

			this._canvas.getObjects().forEach(element => {
				if (element.name === NAME_PLAYHEAD) {
					// Move playhead and bring to front.
					element.set({
						left: left,
						height: height,
						width: width
					})
					element.bringToFront()
				}
			})
			this._canvas.renderAll()
		}
	}

	/**
	 * Draws a timeline state to the canvas.
	 * @param {TimelineDrawState} currentDrawState State to draw.
	 */
	drawTimelineState (currentDrawState: TimelineDrawState) {
		// Iterate through cavas.
		// Seemingly the only way to update objects without clearing the canvas.
		this._canvas.getObjects().forEach(element => {
			if (element.name !== undefined) {
				// Only interested in fabric.Rect and fabric.Text
				if (element.type === 'rect' || element.type === 'text') {
					// Check element is affected by current state.
					// Note: This allows for partial updates.
					if (element.name in currentDrawState) {
						let state = currentDrawState[element.name]

						// Text objects shouldn't have their dimensions modified.
						if (element.type === 'text') {
							element.set({
								top: state.top,
								left: state.left,
								visible: state.visible
								// visible: ((element.width as number) <= state.width) ? state.visible : false // Only show if text fits within timeline object.
							})
							element.setCoords()
							element.moveTo(101)
						} else {
							element.set({
								height: state.height,
								left: state.left,
								top: state.top,
								width: Math.max(1,state.width), // allways let it be at least one pixel wide
								visible: state.visible
							})
							element.setCoords()
							element.moveTo(100)
						}
					}
				}
			}
		})

		// Tell canvas to re-render all objects.
		this._canvas.renderAll()
	}

	/**
	 * Returns the draw states for all timeline objects.
	 * @param {ResolvedTimeline} timeline Timeline to draw.
	 * @param {number} timelineIndex Index of timeline being drawn.
	 * @returns {TimelineDrawState} State of time-based objects.
	 */
	getTimelineDrawState (timeline: ResolvedTimeline, timelineIndex: number): TimelineDrawState {
		let currentDrawState: TimelineDrawState = {}

		for (let key in timeline.objects) {
			let timeObj = timeline.objects[key]
			let parentID = timeObj.id

			for (let _i = 0; _i < timeObj.resolved.instances.length; _i++) {
				let instanceObj = timeObj.resolved.instances[_i]
				let name = 'timelineObject:' + timelineIndex.toString() + ':' + parentID + ':' + instanceObj.id

				currentDrawState[name] = this.createStateForObject(
					timeObj.layer + '',
					instanceObj.start,
					instanceObj.end
				)
			}
		}

		return currentDrawState
	}

	/**
	 * Creates a draw state for a timeline object.
	 * @param {string} layer Object's layer.
	 * @param {number} start Start time.
	 * @param {number} end End time.
	 * @returns {DrawState} State of the object to draw.
	 */
	createStateForObject (layer: string, start: number, end: number | null): DrawState {
		// Default state (hidden).
		let state: DrawState = { height: 0, left: 0, top: 0, width: 0, visible: false }
		// State should be default if the object is not being shown.
		if (this.showOnTimeline(start, end)) {
			// Get object dimensions and position.
			let objectWidth = this.getObjectWidth(start, end)
			let objectTop = this.getObjectOffsetFromTop(layer)

			// Set state properties.
			state.height = this._timelineObjectHeight
			state.left = this._timelineStart + this.getObjectOffsetFromTimelineStart(start)
			state.top = objectTop
			state.width = objectWidth
			state.visible = true
		}

		return state
	}

	/**
	 * Creates a draw state for a timeline object.
	 * @param {TimelineObjectInstance} object Object to draw.
	 * @param {string} parentName Name of the object's parent (the object the instance belongs to).
	 */
	createFabricObject (name: string) {
		let displayName = name.split(':')[2]

		let resolvedObjectRect = new fabric.Rect({
			left: 0,
			width: 0,
			height: 0,
			top: 0,
			fill: COLOR_TIMELINE_OBJECT_FILL,
			stroke: COLOR_TIMELINE_OBJECT_BORDER,
			strokeWidth: THICKNESS_TIMELINE_OBJECT_BORDER,
			selectable: false,
			visible: false,
			name: name
		})

		let resolvedObjectLabel = new fabric.Text(displayName, {
			fontFamily: TEXT_FONT_FAMILY,
			fontSize: TEXT_FONT_SIZE,
			textAlign: 'center',
			fill: TEXT_COLOR,
			selectable: false,
			top: 0,
			left: 0,
			visible: false,
			name: name
		})

		this._canvas.add(resolvedObjectRect)
		this._canvas.add(resolvedObjectLabel)

		// Add generated objects names to list to prevent duplication.
		this._fabricObjects.push(name)
	}

	/**
	 * Creates all the fabric objects for time-based objects.
	 * @param {ResolvedTimelineObjects} timeline Objects to draw.
	 * @param {number} timelineIndex Index of timeline being drawn.
	 */
	createTimelineFabricObjects (timeline: ResolvedTimelineObjects, timelineIndex: number) {
		for (let key in timeline) {
			// Store timeline object to save on array indexing.
			let timeObj = timeline[key]

			for (let _i = 0; _i < timeline[key].resolved.instances.length; _i++) {
				// Create name.
				let name = 'timelineObject:' + timelineIndex.toString() + ':' + timeObj.id + ':' + timeObj.resolved.instances[_i].id

				// If the object doesn't already have fabric objects, create new ones.
				if (this._fabricObjects.indexOf(name) === -1) {
					this.createFabricObject(name)
				}
			}
		}
	}

	/**
	 * Hides all of the timeline objects in the current state.
	 * @param currentDrawState State to hide.
	 */
	hideTimelineFabricObjects (currentDrawState: TimelineDrawState) {
		this._canvas.getObjects().forEach(element => {
			if (element.name !== undefined) {
				// Only interested in fabric.Rect and fabric.Text
				if (element.type === 'rect' || element.type === 'text') {
					// Check element is affected by current state.
					if (element.name in currentDrawState) {
						if (element.type === 'text') {
							element.set({
								top: 0,
								left: 0,
								visible: false
							})
						} else {
							element.set({
								top: 0,
								left: 0,
								width: 0,
								height: 0,
								visible: false
							})
						}
					}
				}
			}
		})

		// Tell canvas to re-render all objects.
		this._canvas.renderAll()
	}

	/**
	 * Finds the object with the latest end time in a timeline and returns the time.
	 * @param {ResolvedTimeline} timeline Timeline to search.
	 * @returns Latest end time.
	 */
	findMaxEndTime (timeline: ResolvedTimeline): number {
		// Store first end time as max.
		let max = timeline.objects[0].resolved.instances[0].end as number

		// Iterate through start times, if any time is later than current max, replace max.
		if (Object.keys(timeline.objects).length > 1) {
			for (let key in timeline.objects) {
				for (let _i = 1; _i < timeline.objects[key].resolved.instances.length; _i++) {
					if (timeline.objects[key].resolved.instances[_i].end === undefined || timeline.objects[key].resolved.instances[_i].end === null) {
						break
					} else {
						let time = timeline.objects[key].resolved.instances[_i].end as number

						max = (time > max) ? time : max
					}
				}
			}
		}

		return max
	}

	/**
	 * Calculates the offset, in pixels from the start of the timeline for an object.
	 * @param {number} start start time of the object.
	 * @returns {number} Offset in pixels.
	 */
	getObjectOffsetFromTimelineStart (start: number): number {
		// Calculate offset.
		let offset = (start - this._drawTimeStart) * this._pixelsWidthPerUnitTime

		// Offset cannot be to the left of the timeline start position.
		if (offset < 0) {
			offset = 0
		}

		return offset
	}

	/**
	 * Calculates the width, in pixels, of an object based on its duration.
	 * @param {number} start Start time of the object.
	 * @param {number} end End time of the object.
	 * @returns {number} Width in pixels.
	 */
	getObjectWidth (startTime: number, endTime: number | null): number {

		if (!endTime) return this._canvasWidth

		// If the start time is less than the timeline start, set to timeline start.
		if (startTime < this._drawTimeStart) {
			startTime = this._drawTimeStart
		}

		// Calculate duration of the object remaining on the timeline.
		let duration = endTime - startTime

		// Return end point position in pixels.
		return duration * this._pixelsWidthPerUnitTime
	}

	/**
	 * Determines whether to show an object on the timeline.
	 * @param {number} start Object start time.
	 * @param {number} end Object end time.
	 * @returns {true} if object should be shown on the timeline.
	 */
	showOnTimeline (start: number, end: number | null) {
		let isAfter = start >= this._drawTimeEnd
		let isBefore = (end || Infinity) <= this._drawTimeStart
		return !isAfter && !isBefore
	}

	/**
	 * Calculate position of object instance from top of timeline according to its layer.
	 * @param {string} layer Object's layer.
	 * @returns Position relative to top of canvas in pixels.
	 */
	getObjectOffsetFromTop (layerName: string): number {
		let top = this._layerLabels[layerName]

		return top * this._rowHeight
	}

	/**
	 * Moves the playhead. Called periodically.
	 */
	updateDraw () {
		const now = Date.now()
		// How long time since last update:
		const dt: number = (
			this._updateDrawLastTime > 0 ?
			now - this._updateDrawLastTime :
			1
		) / 1000

		this._updateDrawLastTime = now

		// Check playhead should be drawn.

		let updatePlayhead: boolean = false
		let updateEverything: boolean = false

		if (this._playHeadPlaying && this._drawPlayhead) {
			// Add time to playhead.
			this._playHeadTime += this._playSpeed * dt

			updatePlayhead = true
		}
		if (this._playViewPort) {
			let play = true
			if (this._playHeadPlaying && this._drawPlayhead) {
				// Only play if playhead is visible
				if (
					this._playHeadTime > this._drawTimeEnd ||
					this._playHeadTime < this._drawTimeStart
				) {
					play = false
				}
			}
			if (play) {
				this._drawTimeStart += this._playSpeed * dt
				this._drawTimeEnd += this._playSpeed * dt
				updateEverything = true
			}
		}

		if (updateEverything) {
			this.redrawTimeline()
		} else if (updatePlayhead) {
			// Calculate new playhead position and redraw if the playhead has moved.
			if (this.computePlayheadPosition()) {
				this.redrawPlayHead()
			}
		}
		// call this function on next frame
		window.requestAnimationFrame(() => this.updateDraw())
	}

	/**
	 * Calulates the playhead position based on time.
	 * @returns true if the playhead has moved.
	 */
	computePlayheadPosition (): boolean {
		// Get playhead position.
		let pos = this.timeToXCoord(this._playHeadTime)

		// Redraw if playhead has moved.
		if (pos !== this._playHeadPosition) {
			this._playHeadPosition = pos
			return true
		}

		return false
	}

	/**
	 * Handles mouse down event.
	 * @param opt Mouse event.
	 */
	canvasMouseDown (opt) {
		// Extract event.
		let event = opt.e

		// Store mouse is down.
		this._mouseDown = true

		// Store X position of mouse on click.
		this._mouseLastX = event.clientX

		// Prevent event.
		event.preventDefault()
		event.stopPropagation()
	}

	/**
	 * Handles mouse up event.
	 * @param opt Mouse event.
	 */
	canvasMouseUp (opt) {
		// Mouse no longer down.
		this._mouseDown = false
		// Reset scroll direction.
		this._lastScrollDirection = 0

		// Prevent event.
		opt.e.preventDefault()
		opt.e.stopPropagation()
	}

	/**
	 * Handles mouse movement on canvas.
	 * @param opt Mouse event.
	 */
	canvasMouseMove (opt) {
		// If mouse is down.
		if (this._mouseDown) {
			// Extract event.
			let event = opt.e

			// If we are beginning scrolling, we can move freely.
			if (this._lastScrollDirection === undefined || this._lastScrollDirection === 0) {
				// Store current mouse X.
				this._mouseLastX = event.clientX

				// Calculate change in X.
				let deltaX = event.clientX - this._mouseLastX

				// Store scrolling direction.
				if (deltaX < 0) {
					this._lastScrollDirection = -1
				} else {
					this._lastScrollDirection = 1
				}

				// Scroll to new X position.
				this.canvasScrollByDeltaX(-deltaX)
			} else {
				// Calculate scroll direction.
				let direction = this._mouseLastX - event.clientX

				// If changing direction, store new direction but don't scroll.
				if (direction < 0 && this._lastScrollDirection === 1) {
					this._mouseLastX = event.clientX

					this._lastScrollDirection = -1
				} else if (direction > 0 && this._lastScrollDirection === -1) {
					this._mouseLastX = event.clientX

					this._lastScrollDirection = 1
				} else {
					// Calculate change in X.
					let deltaX = event.clientX - this._mouseLastX

					// Store last X position.
					this._mouseLastX = event.clientX

					// Move by change in X.
					this.canvasScrollByDeltaX(-deltaX)
				}
			}
		}
	}

	/**
	 * Handles scroll wheel events on the canvas.
	 * @param opt Scroll event.
	 */
	canvasScrollWheel (opt) {
		// Extract event.
		let event = opt.e

		// Get mouse pointer coordinates on canvas.
		let canvasCoord = this._canvas.getPointer(event.e)

		// Don't scroll if mouse is not over timeline.
		if (canvasCoord.x <= this._timelineStart) {
			return
		}

		// CTRL + scroll to zoom.
		if (event.ctrlKey === true) {
			// If scrolling "up".
			if (event.deltaY > 0) {
				// Zoom out.
				this._timelineZoom = this._timelineZoom * Math.pow(ZOOM_FACTOR, Math.abs(event.deltaY))

				// Zoom relative to cursor position.
				this.zoomUnderCursor(canvasCoord.x)
				this.redrawTimeline()
			} else if (event.deltaY < 0) {
				// Zoom in.
				this._timelineZoom = this._timelineZoom / Math.pow(ZOOM_FACTOR, Math.abs(event.deltaY))

				// Zoom relative to cursor position.
				this.zoomUnderCursor(canvasCoord.x)
				this.redrawTimeline()
			}
		} else if (event.deltaX !== 0) { // Scroll on x-axis
			// Pan.
			this.canvasScrollByDeltaX((event.deltaX * (PAN_FACTOR * this.stepSize)))
		} else if (event.deltaY !== 0 && event.altKey === true) { // Also scroll on alt-key + scroll y-axis
			// Pan.
			this.canvasScrollByDeltaX((event.deltaY * (PAN_FACTOR * this.stepSize)))
		}

		// Prevent event.
		event.preventDefault()
		event.stopPropagation()
	}

	/**
	 * Scroll across the canvas by a specified X value.
	 * @param {number} deltaX Value to move by.
	 */
	canvasScrollByDeltaX (deltaX: number) {
		// Calculate new starting time.
		let targetStart = this._drawTimeStart + (deltaX / this._pixelsWidthPerUnitTime)

		// Starting time cannot be < 0.
		if (targetStart < 0) {
			targetStart = 0
		}

		// Optimisation, don't redraw if nothing has changed.
		if (targetStart === this._drawTimeStart) {
			return
		}

		// Calculate end point.
		let targetEnd = targetStart + this._scaledDrawTimeRange

		// Update timeline start and end values.
		this._drawTimeStart = targetStart
		this._drawTimeEnd = targetEnd

		// Redraw timeline.
		this.redrawTimeline()
	}

	/**
	 * Called when a canvas object is hovered over.
	 * @param {fabric.IEvent} event Hover event.
	 * @param {boolean} over Whether the cursor has moved over an object or out of an object.
	 */
	canvasObjectHover (event: fabric.IEvent, over: boolean) {
		if (over) {
			if (event.target !== undefined) {
				if (event.target.name !== undefined) {
					// Get object metadata from the object name of the hovered object.
					let meta = this.timelineMetaFromString(event.target.name)

					// If we are hovering over a timeline object.
					if (meta !== undefined && meta.type === 'timelineObject') {
						// Get the timeline object and the instance being hovered over.
						let timelineObject = this._resolvedTimelines[meta.timelineIndex].objects[meta.name]
						let instance = timelineObject.resolved.instances.find(instance => instance.id === (meta as TimelineObjectMetaData).instance) as TimelineObjectInstance

						// Get the position of the cursor relative to the canvas.
						let cursorPostion = this._canvas.getPointer(event.e)

						// Construct hover info.
						let hoverInfo: HoveredObject = {
							object: timelineObject,
							instance: instance,
							pointer: { xPostion: cursorPostion.x, yPosition: cursorPostion.y }
						}

						this._hoveredOver = hoverInfo
					}
				}
			}
		} else {
			this._hoveredOver = undefined
		}

		// Send a DOM event.
		dispatchEvent(new CustomEvent('timeline:hover', {
			detail: this._hoveredOver
		}))
	}

	/**
	 * Calculates the new scaled timeline start and end times according to the current zoom value.
	 */
	updateScaledDrawTimeRange () {
		this._scaledDrawTimeRange = this._drawTimeRange * (this._timelineZoom / 100)
	}

	/**
	 * Zooms into/out of timeline, keeping the time under the cursor in the same position.
	 * @param cursorX Position of mouse cursor.
	 */
	zoomUnderCursor (cursorX: number) {
		// Get time under cursor.
		let coordToTime = this.cursorPosToTime(cursorX)

		// Calculate position of mouse relative to edges of timeline.
		let ratio = this.getCursorPositionAcrossTimeline(cursorX)

		// Set zoom values.
		this.updateScaledDrawTimeRange()

		// Calculate start and end values.
		let targetStart = coordToTime - (ratio * this._scaledDrawTimeRange)
		let targetEnd = targetStart + this._scaledDrawTimeRange

		// Start cannot be less than 0 but we must preserve the time range to draw.
		if (targetStart < 0) {
			let diff = -targetStart
			targetStart = 0
			targetEnd += diff
		}

		// Set draw times.
		this._drawTimeStart = targetStart
		this._drawTimeEnd = targetEnd
	}

	/**
	 * Gets the current time under the mouse cursor.
	 * @param cursorX Mouse cursor position (x-axis).
	 * @returns Time under cursor, or -1 if the cursor is not over the timeline.
	 */
	cursorPosToTime (cursorX: number): number {
		// Check if over timeline.
		if (cursorX <= this._timelineStart || cursorX >= this._timelineStart + this._timelineWidth) {
			return -1
		}

		let ratio = this.getCursorPositionAcrossTimeline(cursorX)

		return this._drawTimeStart + (this._scaledDrawTimeRange * ratio)
	}

	/**
	 * Gets the position of the mouse cursor as a percentage of the width of the timeline.
	 * @param cursorX Mouse cursor position.
	 * @returns Cursor position relative to timeline width, or -1 if the cursor is not over the timeline.
	 */
	getCursorPositionAcrossTimeline (cursorX: number): number {
		// Check if over timeline.
		if (cursorX <= this._timelineStart || cursorX >= this._timelineStart + this._timelineWidth) {
			return -1
		}

		let diffX = cursorX - this._timelineStart
		let ratio = diffX / this._timelineWidth

		return ratio
	}

	/**
	 * Calculates the X position of a time value.
	 * @param {number} time The time to convert.
	 * @returns {number} The X coordinate of the time.
	 */
	timeToXCoord (time: number): number {
		// If playhead is off the canvas
		if (time < this._drawTimeStart) {
			return -1
		}

		if (time > this._drawTimeEnd) {
			return this._timelineWidth + this._timelineStart
		}

		// (Proportion of time * timeline width) + layer label width
		return ((time - this._drawTimeStart) / (this._drawTimeEnd - this._drawTimeStart) * this._timelineWidth) + this._timelineStart
	}

	/**
	 * Trims a timeline so that objects only exist within a specified time period.
	 * @param timeline Timeline to trim.
	 * @param trim Times to trim between.
	 */
	trimTimeline (timeline: ResolvedTimeline, trim: TrimProperties): ResolvedTimeline {
		// The new resolved objects.
		let newObjects: ResolvedTimelineObjects = {}

		// Iterate through resolved objects.
		Object.keys(timeline.objects).forEach((objId: string) => {
			const obj = timeline.objects[objId]
			obj.resolved.instances.forEach(instance => {
				// Whether to insert this object into the new timeline.
				let useInstance = false

				let newInstance: TimelineObjectInstance = Object.assign({}, instance) // clone

				// If trimming the start time.
				if (trim.start) {
					// If the object ends after the trim start time.
					if ((instance.end || Infinity) > trim.start) {
						useInstance = true
						if (newInstance.start < trim.start) {
							newInstance.start = trim.start
						}
					}
				}

				// If trimming the end time.
				if (trim.end) {
					// If the object starts before the trim end time.
					if (instance.start < trim.end) {
						useInstance = true
						if ((newInstance.end || Infinity) > trim.end) {
							newInstance.end = trim.end
						}
					}
				}

				if (
					useInstance &&
					newInstance.start < (newInstance.end || Infinity)
				) {
					// If there isn't a resolved object for the new instance, create it.
					if (Object.keys(newObjects).indexOf(objId) === -1) {
						let newObject: ResolvedTimelineObject = {
							content: obj.content,
							enable: obj.content,
							id: obj.id,
							layer: obj.layer,
							resolved: {
								instances: [
									newInstance
								],
								levelDeep: obj.resolved.levelDeep,
								resolved: obj.resolved.resolved,
								resolving: obj.resolved.resolving
							}
						}
						newObjects[objId] = newObject
					} else {
						newObjects[objId].resolved.instances.push(newInstance)
					}
				}
			})
		})

		return {
			classes: timeline.classes,
			layers: timeline.layers,
			objects: newObjects,
			options: timeline.options,
			statistics: timeline.statistics
		}
	}

	/**
	 * Merges two timelines by merging instances of objects that intersect each other.
	 * @param past Older timeline.
	 * @param present Newer timeline.
	 * @returns {ResolvedTimeline[2]} [past, present] containing altered values.
	 */
	mergeTimelineObjects (past: ResolvedTimeline, present: ResolvedTimeline) {
		// Iterate over objects in the first timeline.
		Object.keys(past.objects).forEach((objId: string) => {
			const pastObj = past.objects[objId]
			// If an object exists in both timelines,
			if (objId in present.objects) {
				const presentObj = present.objects[objId]

				if (
					// Compare the objects, only look into merging them if they look identical
					isEqual(
						Object.assign({}, pastObj, { resolved: null }),
						Object.assign({}, presentObj, { resolved: null }),
					)
				) {
					// Iterate over all instances of those objects.
					pastObj.resolved.instances.forEach(pastInstance => {
						presentObj.resolved.instances.forEach(presentInstance => {
							// If the instances are next to each other, merge them.
							if (pastInstance.end === presentInstance.start) {
								presentInstance.start = pastInstance.start

								// Remove the older instance.
								pastObj.resolved.instances.splice(
									pastObj.resolved.instances.indexOf(presentInstance),
									1
								)
							}
						})
					})
				} else {
					console.log('not equal:')
					console.log(pastObj)
					console.log(presentObj)
				}
			}
		})
		return { past, present }
	}

	/**
	 * Gets metadata for a timeline object from a string representation.
	 * @param {string} meta Metadata string.
	 * @returns {TimelineObjectMetaData | undefined} Extracted metadata or undefined if the string does not contain the required values.
	 */
	timelineMetaFromString (meta: string): TimelineObjectMetaData | undefined {
		let metaArray = meta.split(':')

		if (metaArray.length === 4) {
			return {
				type: metaArray[0],
				timelineIndex: parseInt(metaArray[1], 10),
				name: metaArray[2],
				instance: metaArray[3]
			}
		}

		return
	}
}
