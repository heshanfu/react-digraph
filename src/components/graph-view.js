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
import ReactDOM from 'react-dom';
import '../styles/main.scss';

import { LayoutEngines } from '../utilities/layout-engine/layout-engine-config';
import { type LayoutEngineType } from '../utilities/layout-engine/layout-engine-types';
import { type IGraphViewProps } from './graph-view-props';
import Background from './background';
import Defs from './defs';
import Edge, { type IEdge, type ITargetPosition } from './edge';
import GraphControls from './graph-controls';
import GraphUtils, { type INodeMapNode } from './graph-util';
import Node, { type INode } from './node';

type IViewTransform = {
  k: number,
  x: number,
  y: number
}

type IGraphViewState = {
  viewTransform?: IViewTransform;
  hoveredNode: boolean;
  nodesMap: any;
  edgesMap: any;
  nodes: any[];
  edges: any[];
  selectingNode: boolean;
  hoveredNodeData: any;
  edgeEndNode: any;
  draggingEdge: boolean;
  draggedEdge: any;
  componentUpToDate: boolean;
  selectedEdgeObj: any;
  selectedNodeObj: any;
};

class GraphView extends React.Component<IGraphViewProps, IGraphViewState> {
  static defaultProps = {
    canCreateEdge: () => true,
    canDeleteEdge: () => true,
    canDeleteNode: () => true,
    edgeArrowSize: 8,
    gridSpacing: 36,
    layoutEngineType: 'None',
    maxTitleChars: 9,
    maxZoom: 1.5,
    minZoom: 0.15,
    nodeSize: 154,
    readOnly: false,
    showGraphControls: true,
    zoomDelay: 500,
    zoomDur: 750
  };

  static getDerivedStateFromProps(nextProps: IGraphViewProps, prevState: IGraphViewState) {
    const { edges, nodeKey } = nextProps;
    let nodes = nextProps.nodes;
    const nodesMap = GraphUtils.getNodesMap(nodes, nodeKey);
    const edgesMap = GraphUtils.getEdgesMap(edges);
    GraphUtils.linkNodesAndEdges(nodesMap, edges);

    const selectedNodeMap =
      nextProps.selected && nodesMap[`key-${nextProps.selected[nodeKey]}`]
        ? nodesMap[`key-${nextProps.selected[nodeKey]}`]
        : null;
    const selectedEdgeMap =
      nextProps.selected && edgesMap[`${nextProps.selected.source}_${nextProps.selected.target}`]
        ? edgesMap[`${nextProps.selected.source}_${nextProps.selected.target}`]
        : null;

    // Handle layoutEngine on initial render
    if (prevState.nodes.length === 0 && nextProps.layoutEngineType && LayoutEngines[nextProps.layoutEngineType]) {
      const layoutEngine = new LayoutEngines[nextProps.layoutEngineType](nextProps);
      const newNodes = layoutEngine.adjustNodes(nodes, nodesMap);
      nodes = newNodes;
    }

    const nextState = {
      componentUpToDate: true,
      edges,
      edgesMap,
      nodes,
      nodesMap,
      readOnly: nextProps.readOnly,
      selectedEdgeObj: {
        edge: selectedEdgeMap ? edges[selectedEdgeMap.originalArrIndex] : null
      },
      selectedNodeObj: {
        index: selectedNodeMap ? selectedNodeMap.originalArrIndex : -1,
        node: selectedNodeMap ? nodes[selectedNodeMap.originalArrIndex] : null
      },
      selectionChanged: false
    };

    return nextState;
  }

  nodeTimeouts: any;
  edgeTimeouts: any;
  renderNodesTimeout: any;
  renderEdgesTimeout: any;
  zoom: any;
  viewWrapper: any;
  entities: any;
  selectedView: any;
  view: any;
  graphControls: any;
  layoutEngine: any;

  constructor(props: IGraphViewProps) {
    super(props);

    this.nodeTimeouts = {};
    this.edgeTimeouts = {};
    this.renderNodesTimeout = null;
    this.renderEdgesTimeout = null;

    this.graphControls = React.createRef();

    if (props.layoutEngineType) {
      this.layoutEngine = new LayoutEngines[props.layoutEngineType](props);
    }

    this.state = {
      componentUpToDate: false,
      draggedEdge: null,
      draggingEdge: false,
      edgeEndNode: null,
      edges: [],
      edgesMap: {},
      hoveredNode: false,
      hoveredNodeData: null,
      nodes: [],
      nodesMap: {},
      selectedEdgeObj: null,
      selectedNodeObj: null,
      selectingNode: false
    };
  }

  componentDidMount() {
    // TODO: can we target the element rather than the document?
    document.addEventListener('keydown', this.handleWrapperKeydown);

    this.zoom = d3
      .zoom()
      .filter(this.zoomFilter)
      .scaleExtent([this.props.minZoom || 0, this.props.maxZoom || 0])
      .on('start', this.handleZoomStart)
      .on('zoom', this.handleZoom)
      .on('end', this.handleZoomEnd);

    d3
      .select(this.viewWrapper)
      .on('touchstart', this.containZoom)
      .on('touchmove', this.containZoom)
      .on('click', this.handleSvgClicked) // handle element click in the element components
      .select('svg')
      .call(this.zoom);

    this.selectedView = d3.select(this.view);

    // On the initial load, the 'view' <g> doesn't exist until componentDidMount.
    // Manually render the first view.
    this.renderView();

    setTimeout(() => {
      if (this.viewWrapper != null) {
        this.handleZoomToFit();
      }
    }, this.props.zoomDelay);
  }

  componentWillUnmount() {
    document.removeEventListener('keydown', this.handleWrapperKeydown);
  }

  shouldComponentUpdate(nextProps: IGraphViewProps, nextState: IGraphViewState) {
    if (
      nextProps.nodes !== this.props.nodes ||
      nextProps.edges !== this.props.edges ||
      !nextState.componentUpToDate ||
      nextProps.selected !== this.props.selected ||
      nextProps.readOnly !== this.props.readOnly ||
      nextProps.layoutEngineType !== this.props.layoutEngineType
    ) {
      return true;
    }
    return false;
  }

  componentDidUpdate(prevProps: IGraphViewProps, prevState: IGraphViewState) {
    const { nodesMap, edgesMap, nodes } = this.state;

    if (this.props.layoutEngineType && LayoutEngines[this.props.layoutEngineType]) {
      this.layoutEngine = new LayoutEngines[this.props.layoutEngineType](this.props);
      const newNodes = this.layoutEngine.adjustNodes(nodes, nodesMap);
      this.setState({
        nodes: newNodes
      });
    }

    // Note: the order is intentional Do not save the timeouts to variables, as
    // subsequent render calls could overwrite timeouts and not render new additions
    // or deletions.
    setTimeout(() => {
      this.addNewNodes(this.state.nodes, prevState.nodesMap);
    });

    // add new edges
    setTimeout(() => {
      this.addNewEdges(this.state.edges, prevState.edgesMap);
    });

    // remove old edges
    setTimeout(() => {
      this.removeOldEdges(prevState.edges, edgesMap);
    });

    // remove old nodes
    setTimeout(() => {
      this.removeOldNodes(prevState.nodesMap, nodesMap);
    });

    this.setState({
      componentUpToDate: true
    });
  }

  getNodeById(id: string | null): INodeMapNode | null {
    return this.state.nodesMap ? this.state.nodesMap[`key-${id || ''}`] : null;
  }

  getEdgeBySourceTarget(source: string, target: string) {
    return this.state.edgesMap ? this.state.edgesMap[`${source}_${target}`] : null;
  }

  deleteNodeById(id: string) {
    if (this.state.nodesMap && this.state.nodesMap[`key-${id}`]) {
      delete this.state.nodesMap[`key-${id}`];
    }
  }

  deleteEdgeBySourceTarget(source: string, target: string) {
    if (this.state.edgesMap && this.state.edgesMap[`${source}_${target}`]) {
      delete this.state.edgesMap[`${source}_${target}`];
    }
  }

  addNewNodes(nodes: INode[], oldNodesMap: any) {
    if (this.state.draggingEdge) {
      return;
    }
    const nodeKey = this.props.nodeKey;
    nodes.forEach((node, i) => {
      const prevNode = oldNodesMap[`key-${node[nodeKey]}`];
      if (prevNode && node !== prevNode.node) {
        // Nodes must be immutable. A node with the same key must not have the same memory reference.
        // Update individual node
        this.asyncRenderNode(node, i);
      } else {
        // New node
        this.asyncRenderNode(node, i);
      }
    });
  }

  removeOldNodes(prevNodeMap: any, nodesMap: any) {
    const nodeKey = this.props.nodeKey;
    // remove old nodes
    Object.keys(prevNodeMap).forEach((nodeId) => {
      // Check for deletions
      if (!nodesMap[nodeId]) {
        // remove all outgoing edges
        prevNodeMap[nodeId].outgoingEdges.forEach((edge) => {
          this.removeEdgeElement(edge.source, edge.target);
        });

        // remove all incoming edges
        prevNodeMap[nodeId].incomingEdges.forEach((edge) => {
          this.removeEdgeElement(edge.source, edge.target);
        });

        // remove node
        const id = prevNodeMap[nodeId].node[nodeKey];
        GraphUtils.removeElementFromDom(`node-${id}-container`);
      }
    });
  }

  addNewEdges(edges: IEdge[], oldEdgesMap: any) {
    if (!this.state.draggingEdge) {
      edges.forEach((edge) => {
        if (!edge.source || !edge.target) {
          return;
        }
        const prevEdge = oldEdgesMap[`${edge.source}_${edge.target}`];
        if (!prevEdge) {
          // new edge
          this.asyncRenderEdge(edge);
        }
      });
    }
  }

  removeOldEdges = (prevEdges: IEdge[], edgesMap: any) => {
    // remove old edges
    prevEdges.forEach((edge) => {
      // Check for deletions
      if (!edge.source || !edge.target) {
        return;
      }
      if (!edgesMap[`${edge.source}_${edge.target}`]) {
        // remove edge
        this.removeEdgeElement(edge.source, edge.target);
      }
    });
  }

  removeEdgeElement(source: string, target: string) {
    const id = `${source}-${target}`;
    GraphUtils.removeElementFromDom(`edge-${id}-container`);
  }

  zoomFilter() {
    return !d3.event.path.find((el) => {
      return el.classList && el.classList.contains('node');
    });
  }

  canSwap(sourceNode: INode, hoveredNode: INode, swapEdge: any) {
    return (
      hoveredNode &&
      (swapEdge.source !== sourceNode[this.props.nodeKey] || swapEdge.target !== hoveredNode[this.props.nodeKey])
    );
  }

  deleteNode(selectedNode: INode) {
    const { nodeKey } = this.props;
    const { nodes } = this.state;

    const nodeId = selectedNode[nodeKey];
    const originalArrIndex = (this.getNodeById(nodeId): any).originalArrIndex;

    // delete from local state
    this.deleteNodeById(nodeId);
    nodes.splice(originalArrIndex, 1);
    this.setState({
      componentUpToDate: false,
      hoveredNode: false,
      nodes
    });

    // remove from UI
    GraphUtils.removeElementFromDom(`node-${nodeId}-container`);

    // inform consumer
    this.props.onDeleteNode(selectedNode, originalArrIndex, nodes);
    this.props.onSelectNode(null);
  }

  deleteEdge(selectedEdge: IEdge) {
    const { edges } = this.state;
    if (!selectedEdge.source || !selectedEdge.target) {
      return;
    }

    const originalArrIndex = (this.getEdgeBySourceTarget(selectedEdge.source, selectedEdge.target): any).originalArrIndex;

    edges.splice(originalArrIndex, 1);
    if (selectedEdge.source && selectedEdge.target) {
      this.deleteEdgeBySourceTarget(selectedEdge.source, selectedEdge.target);
    }

    this.setState({
      componentUpToDate: false,
      edges
    });

    // remove from UI
    if (selectedEdge.source && selectedEdge.target) {
      GraphUtils.removeElementFromDom(`edge-${selectedEdge.source}-${selectedEdge.target}-container`);
    }

    // inform consumer
    this.props.onDeleteEdge(selectedEdge, originalArrIndex, edges);
  }

  handleDelete = (selected: IEdge | INode) => {
    const { canDeleteNode, canDeleteEdge, readOnly } = this.props;

    if (readOnly || !selected) { return; }
    if (!selected.source && canDeleteNode && canDeleteNode(selected)) {
      // node
      // $FlowFixMe
      this.deleteNode(selected);
    } else if (selected.source && canDeleteEdge && canDeleteEdge(selected)) {
      // edge
      // $FlowFixMe
      this.deleteEdge(selected);
    }
  }

  handleWrapperKeydown: KeyboardEventListener = (d) => {
    // Conditionally ignore keypress events on the window
    switch (d.key) {
      case 'Delete':
      case 'Backspace':
        if (this.state.selectedNodeObj) {
          this.handleDelete(this.state.selectedNodeObj.node || this.props.selected);
        }
        break;
      case 'z':
        if ((d.metaKey || d.ctrlKey) && this.props.onUndo) {
          this.props.onUndo();
        }
        break;
      case 'c':
        if ((d.metaKey || d.ctrlKey) && this.state.selectedNodeObj.node && this.props.onCopySelected) {
          this.props.onCopySelected();
        }
        break;
      case 'v':
        if ((d.metaKey || d.ctrlKey) && this.state.selectedNodeObj.node && this.props.onPasteSelected) {
          this.props.onPasteSelected();
        }
        break;
      default:
        break;
    }
  }

  handleEdgeSelected = (e) => {
    const { source, target } = e.target.dataset;
    if (source && target) {
      const originalArrIndex = (this.getEdgeBySourceTarget(source, target): any).originalArrIndex;
      const previousSelection = (this.state.selectedEdgeObj && this.state.selectedEdgeObj.edge) || null;
      this.setState({
        selectedEdgeObj: {
          componentUpToDate: false,
          edge: this.state.edges[originalArrIndex]
        }
      });
      this.syncRenderEdge(this.state.edges[originalArrIndex]);
      if (previousSelection) {
        this.syncRenderEdge(previousSelection);
      }
      this.props.onSelectEdge(this.state.edges[originalArrIndex]);
    }
  }

  handleSvgClicked = (d: any, i: any) => {
    if (this.isPartOfEdge(d3.event.target)) {
      this.handleEdgeSelected(d3.event);
      return; // If any part of the edge is clicked, return
    }

    if (this.state.selectingNode) {
      this.setState({ selectingNode: false });
    } else {
      const previousSelection = (this.state.selectedNodeObj && this.state.selectedNodeObj.node) || null;
      const previousSelectionIndex = (this.state.selectedNodeObj && this.state.selectedNodeObj.index) || -1;

      // de-select the current selection
      this.setState({ selectedNodeObj: null });
      this.props.onSelectNode(null);
      if (previousSelection) {
        this.syncRenderNode(previousSelection, previousSelectionIndex);
      }

      if (!this.props.readOnly && d3.event.shiftKey) {
        const xycoords = d3.mouse(d3.event.target);
        this.props.onCreateNode(xycoords[0], xycoords[1]);
      }
    }
  }

  isPartOfEdge(element) {
    return !!GraphUtils.findParent(element, '.edge-container');
  }

  handleNodeMove = (position: any, index: number, shiftKey: boolean) => {
    const node = this.state.nodes[index];
    const { nodeKey, canCreateEdge, readOnly } = this.props;
    if (readOnly) {
      return;
    }
    if (!shiftKey) {
      node.x = position.x;
      node.y = position.y;

      // Update edges synchronously because async doesn't update fast enough
      const nodeMapNode: INodeMapNode | null = this.getNodeById(node[nodeKey]);

      if (!nodeMapNode) {
        return;
      }

      nodeMapNode.incomingEdges.forEach((edge) => {
        this.syncRenderEdge(edge);
      });
      nodeMapNode.outgoingEdges.forEach((edge) => {
        this.syncRenderEdge(edge);
      });
    } else if (canCreateEdge && canCreateEdge()) {
      // render new edge
      this.syncRenderEdge({ source: node[nodeKey], targetPosition: position });
      this.setState({ draggingEdge: true });
    }
  }

  createNewEdge() {
    const { canCreateEdge, nodeKey, onCreateEdge } = this.props;
    const { edgesMap, edgeEndNode, hoveredNodeData } = this.state;
    GraphUtils.removeElementFromDom('edge-custom-container');

    if (edgeEndNode) {
      const mapId1 = `${hoveredNodeData[nodeKey]}_${edgeEndNode[nodeKey]}`;
      const mapId2 = `${edgeEndNode[nodeKey]}_${hoveredNodeData[nodeKey]}`;
      if (
        edgesMap &&
        hoveredNodeData !== edgeEndNode &&
        canCreateEdge &&
        canCreateEdge() &&
        !edgesMap[mapId1] &&
        !edgesMap[mapId2]
      ) {
        const edge: IEdge = {
          source: hoveredNodeData[nodeKey],
          target: edgeEndNode[nodeKey]
        };
        this.setState({
          componentUpToDate: false,
          draggedEdge: null,
          draggingEdge: false
        });

        // this syncRenderEdge will render the edge as un-selected.
        this.syncRenderEdge(edge);
        // we expect the parent website to set the selected property to the new edge when it's created
        onCreateEdge(hoveredNodeData, edgeEndNode);
      }
    }
  }

  handleNodeUpdate = (position: any, index: number, shiftKey: boolean) => {
    const { onUpdateNode } = this.props;
    const { nodes } = this.state;

    // Detect if edge is being drawn and link to hovered node
    // This will handle a new edge
    if (shiftKey) {
      this.createNewEdge();
    } else {
      const node = nodes[index];
      if (node) {
        Object.assign(node, position);
        onUpdateNode(node);
      }
    }
    // force a re-render
    this.setState({
      componentUpToDate: false,
      // Setting hoveredNode to false here because the layout engine doesn't
      // fire the mouseLeave event when nodes are moved.
      hoveredNode: false
    });
  }

  handleNodeMouseEnter = (event: any, data: any, hovered: boolean) => {
    // hovered is false when creating edges
    if (hovered && !this.state.hoveredNode) {
      this.setState({
        hoveredNode: true,
        hoveredNodeData: data
      });
    } else if (!hovered && this.state.hoveredNode && this.state.draggingEdge) {
      this.setState({
        edgeEndNode: data
      });
    } else {
      this.setState({
        hoveredNode: true,
        hoveredNodeData: data
      });
    }
  }

  handleNodeMouseLeave = (event: any, data: any) => {
    if (
      (d3.event && d3.event.toElement && GraphUtils.findParent(d3.event.toElement, '.node')) ||
      (event && event.relatedTarget && GraphUtils.findParent(event.relatedTarget, '.node')) ||
      (d3.event && d3.event.buttons === 1) ||
      (event && event.buttons === 1)
    ) {
      // still within a node
      return;
    }
    if (event && event.relatedTarget) {
      if (event.relatedTarget.classList.contains('edge-overlay-path')) {
        return;
      }
      this.setState({ hoveredNode: false, edgeEndNode: null });
    }
  }

  handleNodeSelected = (node: INode, index: number, creatingEdge: boolean) => {
    // if creatingEdge then de-select nodes and select new edge instead
    const previousSelection = (this.state.selectedNodeObj && this.state.selectedNodeObj.node) || null;
    const previousSelectionIndex = previousSelection ? this.state.selectedNodeObj.index : -1;
    const newState = {
      componentUpToDate: false,
      selectedNodeObj: {
        index,
        node
      }
    };
    this.setState(newState);

    // render both previous selection and new selection
    this.syncRenderNode(node, index);
    if (previousSelection) {
      this.syncRenderNode(previousSelection, previousSelectionIndex);
    }

    if (!creatingEdge) {
      this.props.onSelectNode(node);
    }
  }

  // One can't attach handlers to 'markers' or obtain them from the event.target
  // If the click occurs within a certain radius of edge target, assume the click
  // occurred on the arrow
  arrowClicked(edge: IEdge | null) {
    const { nodeSize, edgeArrowSize } = this.props;
    const eventTarget = d3.event.sourceEvent.target;
    if (!edge || eventTarget.tagName !== 'path') {
      return false; // If the handle is clicked
    }

    const xycoords = d3.mouse(eventTarget);
    if (!edge.target) {
      return false;
    }
    const targetNodeMapNode = this.getNodeById(edge.target);
    const source = {
      x: xycoords[0],
      y: xycoords[1]
    };
    const target = targetNodeMapNode ? this.state.nodes[targetNodeMapNode.originalArrIndex] : source;
    const dist = Edge.getDistance(
      source,
      target
    );
    return dist < (nodeSize || 0) / 2 + (edgeArrowSize || 0) + 10; // or *2 or ^2?
  }

  // Keeps 'zoom' contained
  containZoom() {
    d3.event.preventDefault();
  }

  handleZoomStart = () => {
    // Zoom start events also handle edge clicks. We need to determine if an edge
    // was clicked and deal with that scenario.
    const sourceEvent = d3.event.sourceEvent;

    if (
      this.props.readOnly ||
      !sourceEvent ||
      (sourceEvent && !sourceEvent.target.classList.contains('edge-overlay-path'))
    ) {
      return;
    }

    // Clicked on the edge.
    const { target } = sourceEvent;
    const edgeId = target.id;
    const edge = this.state.edgesMap && this.state.edgesMap[edgeId] ? this.state.edgesMap[edgeId].edge : null;

    // Only move edges if the arrow is dragged
    if (!this.arrowClicked(edge) || !edge) {
      return;
    }
    this.removeEdgeElement(edge.source, edge.target);
    this.setState({ draggingEdge: true, draggedEdge: edge });
    this.dragEdge(edge);
  }

  dragEdge(draggedEdge?: IEdge) {
    const { nodeSize } = this.props;
    draggedEdge = draggedEdge || this.state.draggedEdge;
    if (!draggedEdge) {
      return;
    }
    const mouseCoordinates = d3.mouse(this.selectedView.node());
    const mouseX = mouseCoordinates[0];
    const mouseY = mouseCoordinates[1];
    const targetPosition = {
      x: mouseX,
      y: mouseY
    };
    const off = Edge.calculateOffset(nodeSize, (this.getNodeById(draggedEdge.source): any).node, targetPosition);
    targetPosition.x += off.xOff;
    targetPosition.y += off.yOff;
    this.syncRenderEdge({ source: draggedEdge.source, targetPosition });
    this.setState({ draggedEdge });
  }

  // View 'zoom' handler
  handleZoom = () => {
    const { draggingEdge, hoveredNode } = this.state;
    const transform: IViewTransform = d3.event.transform;
    if (!hoveredNode && !draggingEdge) {
      d3.select(this.view).attr('transform', transform);
      // prevent re-rendering on zoom
      if (this.state.viewTransform !== transform) {
        this.setState({ viewTransform: transform }, () => {
          // force the child components which are related to zoom level to update
          this.renderGraphControls();
        });
      }
    } else if (draggingEdge) {
      this.dragEdge();
    }
  }

  handleZoomEnd = () => {
    const { draggingEdge, draggedEdge, edgeEndNode } = this.state;
    const { nodeKey } = this.props;

    if (!draggingEdge || !draggedEdge) {
      return;
    }

    // Zoom start events also handle edge clicks. We need to determine if an edge
    // was clicked and deal with that scenario.
    const draggedEdgeCopy = { ...this.state.draggedEdge };

    // remove custom edge
    GraphUtils.removeElementFromDom('edge-custom-container');
    this.setState(
      {
        draggedEdge: null,
        draggingEdge: false
      },
      () => {
        const sourceNode = (this.getNodeById(draggedEdge.source): any).node;
        if (this.canSwap(sourceNode, edgeEndNode, draggedEdge)) {
          // determine the target node and update the edge
          draggedEdgeCopy.target = edgeEndNode[nodeKey];
        }
        this.syncRenderEdge(draggedEdgeCopy);
        this.props.onSwapEdge(
          (this.getNodeById(draggedEdgeCopy.source): any).node,
          (this.getNodeById(draggedEdgeCopy.target): any).node,
          draggedEdge
        );
      }
    );
  }

  // Zooms to contents of this.refs.entities
  handleZoomToFit = () => {
    const parent = d3.select(this.viewWrapper).node();
    const entities = d3.select(this.entities).node();

    const viewBBox = entities.getBBox();

    const width = parent.clientWidth;
    const height = parent.clientHeight;
    const minZoom = this.props.minZoom || 0;
    const maxZoom = this.props.maxZoom || 2;

    const next = {
      k: (minZoom + maxZoom) / 2,
      x: 0,
      y: 0,
    };

    if (viewBBox.width > 0 && viewBBox.height > 0) {
      // There are entities
      const dx = viewBBox.width;
      const dy = viewBBox.height;
      const x = viewBBox.x + viewBBox.width / 2;
      const y = viewBBox.y + viewBBox.height / 2;
      next.k = 0.9 / Math.max(dx / width, dy / height);

      if (next.k < minZoom) {
        next.k = minZoom;
      } else if (next.k > maxZoom) {
        next.k = maxZoom;
      }

      next.x = width / 2 - next.k * x;
      next.y = height / 2 - next.k * y;
    }

    this.setZoom(next.k, next.x, next.y, this.props.zoomDur);
  }

  // Updates current viewTransform with some delta
  modifyZoom = (modK: number = 0, modX: number = 0, modY: number = 0, dur: number = 0) => {
    const parent = d3.select(this.viewWrapper).node();
    const center = {
      x: parent.clientWidth / 2,
      y: parent.clientHeight / 2
    };
    const extent = this.zoom.scaleExtent();
    const viewTransform: any = this.state.viewTransform;

    const next = {
      k: viewTransform.k,
      x: viewTransform.x,
      y: viewTransform.y
    };

    const targetZoom = next.k * (1 + modK);
    next.k = targetZoom;

    if (targetZoom < extent[0] || targetZoom > extent[1]) {
      return false;
    }

    const translate0 = {
      x: (center.x - next.x) / next.k,
      y: (center.y - next.y) / next.k
    };

    const l = {
      x: translate0.x * next.k + next.x,
      y: translate0.y * next.k + next.y
    };

    next.x += center.x - l.x + modX;
    next.y += center.y - l.y + modY;
    this.setZoom(next.k, next.x, next.y, dur);
    return true;
  }

  // Programmatically resets zoom
  setZoom(k: number = 1, x: number = 0, y: number = 0, dur: number = 0) {
    const t = d3.zoomIdentity.translate(x, y).scale(k);

    d3
      .select(this.viewWrapper)
      .select('svg')
      .transition()
      .duration(dur)
      .call(this.zoom.transform, t);
  }

  // Renders 'graph' into view element
  renderView() {
    // Update the view w/ new zoom/pan
    this.selectedView.attr('transform', this.state.viewTransform);

    clearTimeout(this.renderNodesTimeout);
    this.renderNodesTimeout = setTimeout(this.renderNodes);
  }

  renderBackground() {
    const { gridSize, backgroundFillId, renderBackground } = this.props;
    if (renderBackground) {
      return renderBackground(gridSize);
    } else {
      return <Background gridSize={gridSize} backgroundFillId={backgroundFillId} />;
    }
  }

  getNodeComponent(id: string, node: INode, index: number) {
    const { nodeTypes, nodeSubtypes, nodeSize, renderNode, renderNodeText } = this.props;
    return (
      <Node
        key={id}
        id={id}
        data={node}
        index={index}
        nodeTypes={nodeTypes}
        nodeSize={nodeSize}
        nodeSubtypes={nodeSubtypes}
        onNodeMouseEnter={this.handleNodeMouseEnter}
        onNodeMouseLeave={this.handleNodeMouseLeave}
        onNodeMove={this.handleNodeMove}
        onNodeUpdate={this.handleNodeUpdate}
        onNodeSelected={this.handleNodeSelected}
        renderNode={renderNode}
        renderNodeText={renderNodeText}
        isSelected={this.state.selectedNodeObj.node === node}
        layoutEngine={this.layoutEngine}
      />
    );
  }

  renderNode(id: string, element: Element) {
    const containerId = `${id}-container`;
    let nodeContainer: HTMLElement | Element | null = document.getElementById(containerId);

    if (!nodeContainer) {
      nodeContainer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      nodeContainer.id = containerId;
      this.entities.appendChild(nodeContainer);
    }

    // ReactDOM.render replaces the insides of an element This renders the element
    // into the nodeContainer
    const anyElement: any = element;
    ReactDOM.render(anyElement, nodeContainer);
  }

  syncRenderConnectedEdgesFromNode(node: INodeMapNode) {
    if (this.state.draggingEdge) {
      return;
    }

    node.incomingEdges.forEach((edge) => {
      this.syncRenderEdge(edge);
    });
    node.outgoingEdges.forEach((edge) => {
      this.syncRenderEdge(edge);
    });
  }

  asyncRenderNode(node: INode, i: number) {
    const nodeKey = this.props.nodeKey;
    const timeoutId = `nodes-${node[nodeKey]}`;
    clearTimeout(this.nodeTimeouts[timeoutId]);
    this.nodeTimeouts[timeoutId] = setTimeout(() => {
      this.syncRenderNode(node, i);
    });
  }

  syncRenderNode(node: INode, i: number) {
    const nodeKey = this.props.nodeKey;
    const id = `node-${node[nodeKey]}`;
    const element: any = this.getNodeComponent(id, node, i);
    const nodesMapNode = this.getNodeById(node[nodeKey]);
    this.renderNode(id, element);
    if (nodesMapNode) {
      this.syncRenderConnectedEdgesFromNode(nodesMapNode);
    }
  }

  isEdgeSelected = (edge: IEdge) => {
    return !!this.state.selectedEdgeObj &&
      !!this.state.selectedEdgeObj.edge &&
      this.state.selectedEdgeObj.edge.source === edge.source &&
      this.state.selectedEdgeObj.edge.target === edge.target;
  }

  renderNodes = () => {
    if (!this.entities) {
      return;
    }

    this.state.nodes.forEach((node, i) => {
      this.asyncRenderNode(node, i);
    });
  }

  getEdgeComponent(edge: IEdge | any) {
    const sourceNodeMapNode = this.getNodeById(edge.source);
    const sourceNode = sourceNodeMapNode ? this.state.nodes[sourceNodeMapNode.originalArrIndex] : null;
    const targetNodeMapNode = this.getNodeById(edge.target);
    const targetNode = targetNodeMapNode ? this.state.nodes[targetNodeMapNode.originalArrIndex] : null;
    const targetPosition = edge.targetPosition;

    return (
      <Edge
        data={edge}
        edgeTypes={this.props.edgeTypes}
        edgeHandleSize={this.props.edgeHandleSize}
        nodeSize={this.props.nodeSize}
        sourceNode={sourceNode}
        targetNode={targetNode || targetPosition}
        isSelected={this.isEdgeSelected(edge)}
      />
    );
  }


  renderEdge = (id: string, element: any, edge: IEdge) => {
    const containerId = `${id}-container`;
    const { draggedEdge } = this.state;
    const edgeContainer = document.getElementById(containerId);
    if (!edgeContainer && edge !== draggedEdge) {
      const newSvgEdgeContainer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      newSvgEdgeContainer.id = containerId;
      this.entities.appendChild(newSvgEdgeContainer);
    }
    // ReactDOM.render replaces the insides of an element This renders the element
    // into the nodeContainer
    if (edgeContainer) {
      ReactDOM.render(element, edgeContainer);
    }
  }

  asyncRenderEdge(edge: IEdge) {
    if(!edge.source || !edge.target){
      return;
    }
    const timeoutId = `edges-${edge.source}-${edge.target}`;
    clearTimeout(this.edgeTimeouts[timeoutId]);
    this.edgeTimeouts[timeoutId] = setTimeout(() => {
      this.syncRenderEdge(edge);
    });
  }


  syncRenderEdge(edge: IEdge | any) {
    if (!edge.source) {
      return;
    }
    // We have to use the 'custom' id when we're drawing a new node
    const idVar = edge.target ? `${edge.source}-${edge.target}` : 'custom';
    const id = `edge-${idVar}`;
    const element = this.getEdgeComponent(edge);
    this.renderEdge(id, element, edge);
  }


  renderEdges = () => {
    if (!this.entities || this.state.draggingEdge) {
      return;
    }

    this.state.edges.forEach((edge) => {
      this.asyncRenderEdge(edge);
    });
  }

  /*
   * GraphControls is a special child component. To maximize responsiveness we disable
   * rendering on zoom level changes, but this component still needs to update.
   * This function ensures that it updates into the container quickly upon zoom changes
   * without causing a full GraphView render.
   */
  renderGraphControls() {
    if (!this.props.showGraphControls) {
      return;
    }

    const graphControlsWrapper = document.querySelector('.graph-controls-wrapper')
    if (graphControlsWrapper) {
      ReactDOM.render(
        <GraphControls
          ref={this.graphControls}
          minZoom={this.props.minZoom}
          maxZoom={this.props.maxZoom}
          zoomLevel={this.state.viewTransform ? this.state.viewTransform.k : 1}
          zoomToFit={this.handleZoomToFit}
          modifyZoom={this.modifyZoom}
        />,
        graphControlsWrapper
      );
    }
  }

  render() {
    const { edgeArrowSize, gridSpacing, gridDotSize, nodeTypes, nodeSubtypes, edgeTypes, renderDefs } = this.props;
    return (
      <div className="view-wrapper" ref={(el) => (this.viewWrapper = el)}>
        <svg className="graph">
          <Defs
            edgeArrowSize={edgeArrowSize}
            gridSpacing={gridSpacing}
            gridDotSize={gridDotSize}
            nodeTypes={nodeTypes}
            nodeSubtypes={nodeSubtypes}
            edgeTypes={edgeTypes}
            renderDefs={renderDefs}
          />
          <g className="view" ref={(el) => (this.view = el)}>
            {this.renderBackground()}

            <g className="entities" ref={(el) => (this.entities = el)} />
          </g>
        </svg>
        <div className="graph-controls-wrapper" />
      </div>
    );
  }
}

export default GraphView;
