/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


importScript("aLibrary.js");


var Hierarchy={};


// CONVERT FROM AN ARRAY OF OBJECTS WITH A parent_field DEFINED TO A TREE OF
// THE SAME, BUT WITH child_field CONTAINING AN ARRAY OF CHILDREN
// ALL OBJECTS MUST HAVE id_field DEFINED
// RETURNS AN ARRAY OF ROOT NODES.
Hierarchy.fromList=function(args){
	ASSERT.hasAttributes(args, ["id_field", "parent_field", "child_field"]);

	var childList={};
	var roots=[];

	args.from.forall(function(p, i){
		if (p[args.parent_field]!=null){
			var peers=childList[p[args.parent_field]];
			if (!peers){
				peers=[];
				childList[p[args.parent_field]]=peers;
			}//endif
			peers.push(p);
		}else{
			roots.push(p);
		}//endif
	});

	var heir=function(children){
		children.forall(function(child, i){
			var grandchildren=childList[child[args.id_field]];
			if (grandchildren){
				child[args.child_field]=grandchildren;
				heir(grandchildren);
			}//endif
		});
	};
	heir(roots);

	return roots;
};


//EXPECTING CERTAIN PARAMETERS:
// from - LIST OF NODES
// id_field - USED TO ID NODE
// fk_field - NAME OF THE CHILDREN ARRAY, CONTAINING IDs
//WILL UPDATE ALL BUGS IN from WITH A descendants_field
Hierarchy.addDescendants=function*(args){
	ASSERT.hasAttributes(args, ["from","id_field","fk_field","descendants_field"]);

	var from=args.from;
	var id=args.id_field;
	var fk=args.fk_field;
	var descendants_field=args.descendants_field;
	var DEBUG=nvl(args.DEBUG, false);
	var DEBUG_MIN=1000000;

	//REVERSE POINTERS
	var allParents=new aRelation();
	var allDescendants=new aRelation();
	from.forall(function(p){
		var children=p[fk];
		if (children) for(var i=children.length;i--;){
			var c=children[i];
			if (c=="") continue;
			allParents.add(c, p[id]);
			allDescendants.add(p[id], c);
		}//for
	});

	//FIND DESCENDANTS
	var a=Log.action("Find Descendants", true);
	yield (Thread.sleep(100));
	var workQueue=new aQueue(Object.keys(allParents.map));

	while(workQueue.length()>0){      //KEEP WORKING WHILE THERE ARE CHANGES
		yield (Thread.yield());
		if (DEBUG){
			if (DEBUG_MIN>workQueue.length() && workQueue.length()%Math.pow(10, Math.round(Math.log(workQueue.length())/Math.log(10))-1)==0){
				Log.actionDone(a);
				a=Log.action("Work queue remaining: "+workQueue.length(), true);
				DEBUG_MIN=workQueue.length();
			}//endif
		}//endif
		var node=workQueue.pop();

		var desc=allDescendants.get(node);

		var parents=allParents.get(node);
		for(var i=parents.length;i--;){
			var parent=parents[i];

			var original=allDescendants.getMap(parent);


			if (original===undefined){
				for(var d=desc.length;d--;){
					allDescendants.add(parent, desc[d]);
				}//for
				workQueue.add(parent);
			}else{
				for(var d=desc.length;d--;){
					if (original[desc[d]]) continue;
					allDescendants.add(parent, desc[d]);
					workQueue.add(parent);
				}//for
			}//endif
		}//for
	}//while

	from.forall(function(p){
		p[descendants_field]=allDescendants.get(p[id]);
	});

	Log.actionDone(a);
	yield (null);
};



// HEAVILY ALTERED FROM BELOW
// STILL NO GOOD BECAUSE CAN NOT HANDLE CYCLES

// Copyright 2012 Rob Righter (@robrighter)
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

//REQUIRES from BE A MAP FROM id_field TO OBJECT
//children_id_field IS THE FIELD THIS LIST OF IDs
Hierarchy.topologicalSort=function(args){
	Map.expecting(args, ["from", "id_field", "children_id_field"]);


	var graph=args.from;
	var id_field=args.id_field;
	var children_field=args.children_id_field;
//	var children_field="_EDGES";

	//ADD EDGES SO FOLLOWING ALGORITHM WORKS
//	forAllKey(graph, function(k, v){
//		v[children_field]=[];
//		v[children_id_field].forall(function(v, i){
//			v[children_field].push(graph[v]);
//		});
//	});


	var numberOfNodes = Object.keys(graph).length;
	var processed = [];
	var unprocessed = [];
	var queue = [];

	function processList(){
		while(processed.length < numberOfNodes){
			for(var i = 0; i < unprocessed.length; i++){
				var nodeid = unprocessed[i];
				if (graph[nodeid].indegrees === 0){
					queue.push(nodeid);
					unprocessed.splice(i, 1); //Remove this node, its all done.
					i--;//decrement i since we just removed that index from the iterated list;
				}//endif
			}//for

			{//HACK
			//THIS IS AN UNPROVEN HACK TO SOLVE THE CYCLE PROBLEM
			//IF A PARENT OF unprocessed NODE HAS BEEN VISITED, THEN THE NODE WILL
			//HAVE __parent DEFINED, AND IN THEORY WE SHOULD BE ABLE CONTINUE
			//WORKING ON THOSE
				if (queue.length==0 && unprocessed.length>0){
					var hasParent=unprocessed.map(function(v,i){if (graph[v].__parent!==undefined) return v;});
					if (hasParent.length==0) Log.error("Isolated cycle found");
					queue.appendArray(hasParent);
				}//endif
			}//END OF HACK

			processStartingPoint(queue.shift());
		}//while
	}//method


	function processStartingPoint(nodeId){
		if (nodeId == undefined){
			throw "You have a cycle!!";
		}
		graph[nodeId][children_field].forall(function(child){
			graph[child].indegrees--;
			graph[child].__parent=graph[nodeId];		//MARKUP FOR HACK
		});
		processed.push(graph[nodeId]);
	}


	function populateIndegreesAndUnprocessed(){
		forAllKey(graph, function(nodeId, node){
			unprocessed.push(nodeId);
			if (node.indegrees===undefined) node.indegrees = 0;
			if (node[children_field]===undefined) node[children_field]=[];

//			if (nodeId=="836963"){
//				Log.note("");
//			}//endif

			node[children_field].forall(function(e){
				if (graph[e]===undefined){
					graph[e]=Map.newInstance(id_field, e);
				}//endif

//				if (nodeId==831910 && e==831532) return;	//REMOVE CYCLE (CAN'T HANDLE CYCLES)

				if (graph[e].indegrees===undefined){
					graph[e].indegrees = 1
				} else{
					graph[e].indegrees++;
				}//endif
			});
		});
	}

	populateIndegreesAndUnprocessed();
	processList();

	if (processed.length!=numberOfNodes) Log.error("broken");
	return processed;
};//method
