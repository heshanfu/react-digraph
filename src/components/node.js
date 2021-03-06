// @flow
/*
  Copyright(c) 2018 Uber Technologies, Inc.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

          http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

import * as d3 from 'd3';
import * as React from 'react';
// This works in Typescript but causes an import loop for Flowtype. We'll just use `any` below.
// import { type LayoutEngine } from '../utilities/layout-engine/layout-engine-config';
import Edge from './edge';
import GraphUtils from './graph-util';
import NodeText from './node-text';

export type INode = {
  title: string;
  x: number;
  y: number;
  type: string;
  subtype?: string;
  [key: string]: any;
};

type INodeProps = {
  data: INode;
  index: number;
  id: string;
  nodeTypes: any; // TODO: make a nodeTypes interface
  nodeSubtypes: any; // TODO: make a nodeSubtypes interface
  opacity?: number;
  nodeSize?: number;
  onNodeMouseEnter: (event: any, data: any, hovered: boolean) => void;
  onNodeMouseLeave: (event: any, data: any) => void;
  onNodeMove: (point: IPoint, index: number, shiftKey: boolean) => void;
  onNodeSelected: (data: any, index: number, shiftKey: boolean) => void;
  onNodeUpdate: (point: IPoint, index: number, shiftKey: boolean) => void;
  renderNode?: (
    nodeRef: any,
    data: any,
    index: number,
    selected: boolean,
    hovered: boolean
  ) => any;
  renderNodeText?: (data: any, index: number, id: string | number, isSelected: boolean) => any;
  isSelected: boolean;
  layoutEngine?: any;
};

type INodeState = {
  hovered: boolean;
  x: number;
  y: number;
  selected: boolean;
  mouseDown: boolean;
};

export type IPoint = {
  x: number;
  y: number;
};

class Node extends React.Component<INodeProps, INodeState> {
  static defaultProps = {
    isSelected: false,
    nodeSize: 154,
    onNodeMouseEnter: () => { return; },
    onNodeMouseLeave: () => { return; },
    onNodeMove: () => { return; },
    onNodeSelected: () => { return; },
    onNodeUpdate: () => { return; }
  };

  static getDerivedStateFromProps(nextProps: INodeProps, prevState: INodeState) {
    return {
      selected: nextProps.isSelected,
      x: nextProps.data.x || 0,
      y: nextProps.data.y || 0
    };
  }

  nodeRef: any;
  oldSibling: any;

  constructor(props: INodeProps) {
    super(props);
    this.state = {
      hovered: false,
      mouseDown: false,
      selected: false,
      x: props.data.x || 0,
      y: props.data.y || 0
    };

    this.nodeRef = React.createRef();
  }

  componentDidMount() {
    const dragFunction = d3
      .drag()
      .on('drag', this.handleMouseMove)
      .on('start', this.handleDragStart)
      .on('end', this.handleDragEnd);
    d3
      .select(this.nodeRef.current)
      .on('mouseout', this.handleMouseOut)
      .call(dragFunction);
  }

  handleMouseMove = () => {
    const mouseButtonDown = d3.event.sourceEvent.buttons === 1;
    const shiftKey = d3.event.sourceEvent.shiftKey;
    const { nodeSize, layoutEngine } = this.props;

    if (!mouseButtonDown) {
      return;
    }

    // While the mouse is down, this function handles all mouse movement
    const newState = {
      x: d3.event.x,
      y: d3.event.y
    };

    if (shiftKey) {
      // draw edge
      // undo the target offset subtraction done by Edge
      const off = Edge.calculateOffset(nodeSize, this.props.data, newState);
      newState.x += off.xOff;
      newState.y += off.yOff;
      // now tell the graph that we're actually drawing an edge
    } else {
      // move node
      if (layoutEngine) {
        Object.assign(newState, layoutEngine.getPositionForNode(newState));
      }
      this.setState(newState);
    }
    this.props.onNodeMove(newState, this.props.index, shiftKey);
  }

  handleDragStart = () => {
    if (!this.nodeRef.current) {
      return;
    }
    if (!this.oldSibling) {
      this.oldSibling = this.nodeRef.current.parentElement.nextSibling;
    }
    // Moves child to the end of the element stack to re-arrange the z-index
    this.nodeRef.current.parentElement.parentElement.appendChild(this.nodeRef.current.parentElement);
  }

  handleDragEnd = () => {
    if (!this.nodeRef.current) {
      return;
    }
    if (this.oldSibling && this.oldSibling.parentElement) {
      this.oldSibling.parentElement.insertBefore(this.nodeRef.current.parentElement, this.oldSibling);
    }
    this.setState({ mouseDown: false });
    const { x, y } = this.state;
    const { data, index } = this.props;
    const shiftKey = d3.event.sourceEvent.shiftKey;
    this.props.onNodeUpdate(
      {
        x,
        y
      },
      index,
      shiftKey
    );

    this.props.onNodeSelected(data, index, shiftKey);
  }

  handleMouseOver = (event: any) => {
    // Detect if mouse is already down and do nothing.
    let hovered = false;
    if ((d3.event && d3.event.buttons !== 1) || (event && event.buttons !== 1)) {
      hovered = true;
      this.setState({ hovered });
    }

    this.props.onNodeMouseEnter(event, this.props.data, hovered);
  }

  handleMouseOut = (event: any) => {
    // Detect if mouse is already down and do nothing. Sometimes the system lags on
    // drag and we don't want the mouseOut to fire while the user is moving the
    // node around

    this.setState({ hovered: false });
    this.props.onNodeMouseLeave(event, this.props.data);
  }

  getNodeTypeXlinkHref(data: INode) {
    const { nodeTypes } = this.props;
    if (data.type && nodeTypes[data.type]) {
      return nodeTypes[data.type].shapeId;
    } else if (nodeTypes.emptyNode) {
      return nodeTypes.emptyNode.shapeId;
    }
    return null;
  }

  getNodeSubtypeXlinkHref(data: INode) {
    const { nodeSubtypes } = this.props;
    if (data.subtype && nodeSubtypes[data.subtype]) {
      return nodeSubtypes[data.subtype].shapeId;
    } else if (nodeSubtypes.emptyNode) {
      return nodeSubtypes.emptyNode.shapeId;
    }
    return null;
  }

  renderShape() {
    const { renderNode, data, index } = this.props;
    const { hovered, selected } = this.state;
    const props = {
      height: this.props.nodeSize || 0,
      width: this.props.nodeSize || 0
    };
    const nodeShapeContainerClassName = GraphUtils.classNames('node-shape-container');
    const nodeClassName = GraphUtils.classNames('shape', { selected, hovered });
    const nodeSubtypeClassName = GraphUtils.classNames('subtype-shape', { selected: this.state.selected });
    if (renderNode) {
      // Originally: graphView, domNode, datum, index, elements.
      return renderNode(this.nodeRef, data, index, selected, hovered);
    } else {
      return (
        <g className={nodeShapeContainerClassName} {...props}>
          {!!data.subtype && (
            <use
              data-index={index}
              className={nodeSubtypeClassName}
              x={-props.width / 2}
              y={-props.height / 2}
              width={props.width}
              height={props.height}
              xlinkHref={this.getNodeSubtypeXlinkHref(data)}
            />
          )}
          <use
            data-index={index}
            className={nodeClassName}
            x={-props.width / 2}
            y={-props.height / 2}
            width={props.width}
            height={props.height}
            xlinkHref={this.getNodeTypeXlinkHref(data)}
          />
        </g>
      );
    }
  }

  renderText() {
    const { data, index, id, nodeTypes, renderNodeText, isSelected } = this.props;
    if (renderNodeText) {
      return renderNodeText(data, index, id, isSelected);
    }
    return (<NodeText data={data} nodeTypes={nodeTypes} isSelected={this.state.selected} />);
  }

  render() {
    const { x, y } = this.state;
    const { opacity, id, data } = this.props;

    const className = GraphUtils.classNames('node', data.type, {
      hovered: this.state.hovered,
      selected: this.state.selected
    });
    return (
      <g
        className={className}
        onMouseOver={this.handleMouseOver}
        onMouseOut={this.handleMouseOut}
        id={id}
        ref={this.nodeRef}
        opacity={opacity}
        transform={`translate(${x}, ${y})`}
      >
        {this.renderShape()}
        {this.renderText()}

      </g>
    );
  }
}

export default Node;
