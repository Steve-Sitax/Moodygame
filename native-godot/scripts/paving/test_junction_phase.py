import unittest
import numpy as np
from shapely.geometry import LineString
from junction_phase import phase_at_boundary

class StraightChain:
    def local(self,p):return p[:,1],None,None,None,None

class JunctionPhaseTests(unittest.TestCase):
    def test_oblique_joint_is_a_complete_row(self):
        x=np.linspace(-2,2,41);p=np.column_stack([x,2.07+.3*x]);pitch=3/13
        v,_=phase_at_boundary(p,StraightChain(),LineString([p[0],p[-1]]),pitch)
        self.assertTrue(np.allclose(v/pitch,np.round(v/pitch),atol=1e-9))
        self.assertLess(np.ptp(v),1e-9)

    def test_interior_keeps_its_rows(self):
        p=np.array([[0,12],[1,14]])
        v,_=phase_at_boundary(p,StraightChain(),LineString([[-2,1.47],[2,2.67]]),3/13)
        self.assertTrue(np.array_equal(v,p[:,1]))

if __name__=='__main__':unittest.main()
