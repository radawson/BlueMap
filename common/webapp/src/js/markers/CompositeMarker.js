/*
 * This file is part of BlueMap, licensed under the MIT License (MIT).
 *
 * Copyright (c) Blue (Lukas Rieger) <https://bluecolored.de>
 * Copyright (c) contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
import {ObjectMarker, LabelPopup} from "./ObjectMarker";
import {ShapeMarker} from "./ShapeMarker";
import {ExtrudeMarker} from "./ExtrudeMarker";
import {LineMarker} from "./LineMarker";
import {PoiMarker} from "./PoiMarker";
import {deepEquals} from "../util/Utils";
import {Vector3} from "three";

export class CompositeMarker extends ObjectMarker {

    /**
     * @param markerId {string}
     */
    constructor(markerId) {
        super(markerId);
        Object.defineProperty(this, 'isCompositeMarker', {value: true});
        this.data.type = "composite";

        this.geometryMarkers = new Map(); // geometry index -> marker
        this._markerData = {};
        
        // Ensure composite marker is visible so child markers render
        this.visible = true;
        this.data.visible = true;
    }

    /**
     * @param markerData {{
     *      position: {x: number, y: number, z: number},
     *      label: string,
     *      detail: string,
     *      geometries: Array<object>,
     *      icon: object,
     *      properties: object,
     *      minDistance: number,
     *      maxDistance: number
     *      }}
     */
    updateFromData(markerData) {
        super.updateFromData(markerData);

        // Update geometries - use position from markerData (which is now set in this.position after super call)
        const geometries = markerData.geometries || [];
        const basePosition = markerData.position || {x: this.position.x, y: this.position.y, z: this.position.z};
        
        if (geometries.length === 0) {
            console.error("CompositeMarker: No geometries provided for marker", this.data.id, "- marker will not be visible");
            console.error("Marker data:", markerData);
        } else {
            console.log("CompositeMarker: Processing", geometries.length, "geometries for marker", this.data.id, "at position", basePosition);
        }
        
        // Always update geometries if they exist
        if (geometries.length > 0) {
            this.updateGeometries(geometries, basePosition);
        }

        // Update icon if present
        if (markerData.icon) {
            this.updateIcon(markerData.icon);
        }

        // Update properties for detail popup
        if (markerData.properties) {
            this.data.properties = markerData.properties;
        }

        // Update min/max distances
        this.fadeDistanceMin = markerData.minDistance || 0;
        this.fadeDistanceMax = markerData.maxDistance !== undefined ? markerData.maxDistance : Number.MAX_VALUE;

        // Save used marker data for next update
        this._markerData = markerData;
    }

    /**
     * Updates the child geometry markers
     * @param geometries {Array<object>}
     * @param basePosition {{x: number, y: number, z: number}}
     */
    updateGeometries(geometries, basePosition) {
        console.log("CompositeMarker.updateGeometries: Processing", geometries.length, "geometries, basePosition:", basePosition);
        
        // Remove old geometry markers that are no longer present
        const currentIndices = new Set(geometries.map((_, idx) => idx));
        for (const [idx, marker] of this.geometryMarkers.entries()) {
            if (!currentIndices.has(idx)) {
                this.remove(marker);
                marker.dispose();
                this.geometryMarkers.delete(idx);
            }
        }

        // Add or update geometry markers
        geometries.forEach((geometry, idx) => {
            if (!geometry || !geometry.type) {
                console.error("CompositeMarker: Invalid geometry at index", idx, geometry);
                return;
            }

            console.log("CompositeMarker: Processing geometry", idx, "type:", geometry.type, geometry);

            let marker = this.geometryMarkers.get(idx);
            const needsNewMarker = !marker || marker.data.type !== geometry.type;

            if (needsNewMarker) {
                if (marker) {
                    this.remove(marker);
                    marker.dispose();
                }
                marker = this.createGeometryMarker(geometry.type, idx);
                if (marker) {
                    console.log("CompositeMarker: Created", geometry.type, "marker at index", idx);
                    this.add(marker);
                    this.geometryMarkers.set(idx, marker);
                } else {
                    console.error("CompositeMarker: Failed to create marker for geometry type", geometry.type, "at index", idx);
                    return;
                }
            }

            if (marker) {
                try {
                    console.log("CompositeMarker: Updating geometry marker", idx, "with data:", geometry);
                    this.updateGeometryMarker(marker, geometry, basePosition);
                    console.log("CompositeMarker: Successfully updated geometry marker", idx);
                } catch (e) {
                    console.error("CompositeMarker: Error updating geometry marker at index", idx, e, e.stack);
                }
            }
        });
        
        console.log("CompositeMarker.updateGeometries: Final geometryMarkers size:", this.geometryMarkers.size);
    }

    /**
     * Creates a marker for a specific geometry type
     * @param type {string}
     * @param idx {number}
     * @returns {Marker|null}
     */
    createGeometryMarker(type, idx) {
        const markerId = `${this.data.id}_geometry_${idx}`;
        switch (type) {
            case "shape": return new ShapeMarker(markerId);
            case "extrude": return new ExtrudeMarker(markerId);
            case "line": return new LineMarker(markerId);
            case "poi": return new PoiMarker(markerId);
            default: return null;
        }
    }

    /**
     * Updates a geometry marker with data
     * @param marker {Marker}
     * @param geometry {object}
     * @param basePosition {{x: number, y: number, z: number}}
     */
    updateGeometryMarker(marker, geometry, basePosition) {
        // For shape/extrude geometries, use the composite marker's position
        // For POI/line geometries, use their specific position if provided
        let position = basePosition;
        if (geometry.type === "poi" && geometry.position) {
            position = geometry.position;
        } else if (geometry.type === "line" && geometry.line && geometry.line.length > 0) {
            // Use first point of line as position
            const firstPoint = geometry.line[0];
            position = {x: firstPoint.x || 0, y: firstPoint.y || 0, z: firstPoint.z || 0};
        } else if ((geometry.type === "shape" || geometry.type === "extrude") && geometry.shape && geometry.shape.length > 0) {
            // For shapes, use the composite marker's position (shape points are relative to this)
            position = basePosition;
        }

        const markerData = {
            position: position,
            label: "",
            listed: false, // Don't list geometry markers separately
            minDistance: this.fadeDistanceMin,
            maxDistance: this.fadeDistanceMax
        };

        // Add geometry-specific data
        if (geometry.type === "shape" || geometry.type === "extrude") {
            // Shape data should be an array of {x, z} objects
            markerData.shape = geometry.shape;
            markerData.holes = geometry.holes || [];
            if (geometry.type === "shape") {
                markerData.shapeY = geometry.shapeY;
            } else {
                markerData.shapeMinY = geometry.shapeMinY;
                markerData.shapeMaxY = geometry.shapeMaxY;
            }
            if (geometry.lineColor) markerData.lineColor = geometry.lineColor;
            if (geometry.fillColor) markerData.fillColor = geometry.fillColor;
            if (geometry.lineWidth !== undefined) markerData.lineWidth = geometry.lineWidth;
            if (geometry.depthTest !== undefined) markerData.depthTest = geometry.depthTest;
        } else if (geometry.type === "line") {
            // Line data should be an array of {x, y, z} objects
            markerData.line = geometry.line;
            if (geometry.lineColor) markerData.lineColor = geometry.lineColor;
            if (geometry.lineWidth !== undefined) markerData.lineWidth = geometry.lineWidth;
            if (geometry.depthTest !== undefined) markerData.depthTest = geometry.depthTest;
        } else if (geometry.type === "poi") {
            if (geometry.icon) {
                markerData.icon = geometry.icon.path || geometry.icon;
                markerData.anchor = geometry.icon.anchor;
            }
            if (geometry.position) {
                markerData.position = geometry.position;
            }
        }

        marker.updateFromData(markerData);
    }

    /**
     * Updates the main icon if present
     * @param iconConfig {object}
     */
    updateIcon(iconConfig) {
        // For now, we'll create a POI marker for the icon if it doesn't exist
        // This could be enhanced to use a custom icon renderer
        if (!this.iconMarker) {
            this.iconMarker = new PoiMarker(`${this.data.id}_icon`);
            this.iconMarker.data.listed = false;
            this.add(this.iconMarker);
        }

        const iconData = {
            position: this.position,
            label: this.data.label || "",
            icon: iconConfig.path,
            anchor: iconConfig.anchor,
            listed: false,
            minDistance: this.fadeDistanceMin,
            maxDistance: this.fadeDistanceMax
        };

        this.iconMarker.updateFromData(iconData);
    }

    /**
     * Override onClick to show properties in detail
     */
    onClick(event) {
        if (event.data.doubleTap) return false;

        // Build detail text from properties
        let detailText = this.data.detail || this.data.label || "";
        if (this.data.properties && Object.keys(this.data.properties).length > 0) {
            detailText += "\n\n";
            for (const [key, value] of Object.entries(this.data.properties)) {
                detailText += `${key}: ${value}\n`;
            }
        }

        if (detailText) {
            let pos = new Vector3();
            if (event.intersection) {
                pos.copy(event.intersection.pointOnLine || event.intersection.point);
                pos.sub(this.position);
            }

            let popup = new LabelPopup(detailText);
            popup.position.copy(pos);
            this.add(popup);
            popup.open();
        }

        if (this.data.link) {
            window.open(this.data.link, this.data.newTab ? '_blank' : '_self');
        }

        return true;
    }

    dispose() {
        super.dispose();

        // Dispose all geometry markers
        for (const marker of this.geometryMarkers.values()) {
            marker.dispose();
        }
        this.geometryMarkers.clear();

        if (this.iconMarker) {
            this.iconMarker.dispose();
            this.iconMarker = null;
        }
    }

}
