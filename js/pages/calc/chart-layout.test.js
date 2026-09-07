import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartPointer, fitBoundaryLabels, chartInfoCorner } from './chart-layout.js';

test('crosshair maps the same data position under zoom and nonuniform canvas scaling', () => {
  for (const [sx, sy] of [[.8,.8],[1,1],[1.5,1.5],[2,1.25]]) {
    assert.deepEqual(chartPointer(20+180*sx,40+75*sy,{left:20,top:40,width:600*sx,height:300*sy},600,300),{x:180,y:75});
  }
});

test('boundary labels stay inside the plot and crowded labels disappear on narrow layouts', () => {
  const labels = [{x:0,size:30},{x:15,size:35},{x:50,size:35},{x:195,size:40}];
  const positions = fitBoundaryLabels(labels,200);
  assert.equal(positions[0],0); assert.equal(positions[1],null); assert.equal(positions[3],160);
  let end=-8;
  positions.forEach((left,i)=>{if(left===null)return;assert.ok(left>=end+8);assert.ok(left+labels[i].size<=200);end=left+labels[i].size;});
  assert.deepEqual(fitBoundaryLabels([{x:5,size:40}],30),[null]);
  assert.deepEqual(fitBoundaryLabels([],0),[]);
});

test('information windows fit compact/wide charts without appearing underneath the pointer', () => {
  for(const [width,height] of [[266,280],[1200,560]]) {
    for(const x of [0,width/2,width])for(const y of [0,height/2,height]){
      const corner=chartInfoCorner(x,y,width,height);
      const boxWidth=Math.min(280,width-16), left=corner.left ?? width-boxWidth-8;
      assert.ok(left>=8 && left+boxWidth<=width-8);
      assert.ok(corner.top>=8 && corner.top+corner.maxHeight<=height-8);
      assert.ok(y<corner.top || y>corner.top+corner.maxHeight);
    }
  }
});
