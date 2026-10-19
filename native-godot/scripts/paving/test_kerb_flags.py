import unittest
import numpy as np
import shapely
from shapely.geometry import Polygon, LineString, Point
from kerb_flags import chart_parts, flags

class KerbFlagsTests(unittest.TestCase):
    def setUp(self):
        self.poly=Polygon([(0,0),(2,0),(2,2),(0,2)])
        self.road=LineString([(-1,-.01),(2.01,-.01),(2.01,3)])

    def test_mitre_independent_of_source_diagonal(self):
        parts=chart_parts(self.poly,self.road)
        self.assertAlmostEqual(sum(f.area for f,_,_ in parts),4)
        def at(x,z):
            candidates=[(a,d) for f,a,d in parts if f.buffer(1e-9).contains(Point(x,z))]
            return candidates[0]
        _,a=at(1.8,.1);_,b=at(1.9,.2)
        self.assertAlmostEqual(abs(a@b),0)
        # The chart change is the corner bisector x+z=2, not either possible source diagonal.
        shared=shapely.union_all([f.boundary for f,_,_ in parts])
        for x in [.4,.8,1.2,1.6]:self.assertLess(shared.distance(Point(x,2-x)),1e-8)

    def test_kerb_phase_and_area(self):
        for indices in [[[0,1,2],[0,2,3]],[[0,1,3],[1,2,3]]]:
            p=np.array([[0,.2,0],[2,.2,0],[2,.2,2],[0,.2,2]])
            rows=np.zeros((6,16),np.float32);rows[:,:3]=p[np.asarray(indices)].reshape(-1,3)
            rows[:,4]=1;rows[:,10:14]=1
            sides,top,report=flags(rows,self.road)
            self.assertEqual(len(sides),0);self.assertAlmostEqual(report['topArea'],4)
            self.assertTrue(np.isfinite(top).all())
            # Every vertex on a kerb away from the corner lies on a longitudinal joint (v=0).
            edge=((abs(top[:,2])<1e-7)&(top[:,0]<1.9))|((abs(top[:,0]-2)<1e-7)&(top[:,2]>.1))
            self.assertTrue(np.all(abs(top[edge,7])<1e-6))

if __name__=='__main__':unittest.main()
