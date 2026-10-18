# Ruien O2 piece: shared dimensions (metres, game coordinates unless noted).
# Game: +x north, +z east, y up, street y = 0.
# Blender: X = game x, Y = -game z, Z = game y.

STREET_Y = 0.0
CROWN_Y = -0.9          # inside of vault crown
FLOOR_Y = -6.1          # channel bed
WATER_Y = -4.6          # normal water
LEDGE_Y = -3.6          # ledge / walkway top
HIGH_WATER_Y = -0.65    # river high water, vliet walls
VLIET_BED_Y = -5.05

# Giant gallery section
GAL_W = 6.0
GAL_CHANNEL_W = 3.0
GAL_LEDGE_W = 1.5
GAL_SPRING_Y = -3.1     # elliptical (basket) vault springs here
GAL_RISE = CROWN_Y - GAL_SPRING_Y   # 2.2

# Vliet
VLIET_X0, VLIET_X1 = -150.0, -142.0
VLIET_Z0, VLIET_Z1 = 48.0, 72.0     # modelled stretch; head wall face at z 72
HEADWALL_T = 1.6                    # head wall thickness
GATE_X = -146.1
GATE_SILL_Y = -5.05

# Gallery centre line (game x, z). Straight through the head wall, an S bend, the long leg.
GAL_PATH_KEYS = [(-146.1, 72.0), (-146.1, 75.0), (-149.1, 82.5), (-149.51, 109.3)]

# Hall C2
HALL_X0, HALL_X1 = -159.5, -140.5
HALL_Z0, HALL_Z1 = 110.5, 138.0
HALL_WALL_T = 1.2
PIER_W = 1.1
HALL_SPRING_Y = -2.5
# Pier lines (bays must fit 6 m gallery mouths at bay centres; see NOTES)
HALL_XL = [-152.75, -146.25]
HALL_ZL = [117.55, 124.05, 131.3]

# Shafts
GRATE_SHAFT = (-149.26, 92.5)   # plan position; moved over the east ledge in the model (see NOTES)
HALL_AIR_SHAFT = (-149.5, 120.81)

# Brick tile (texture space)
BRICK_TILE = (4.8, 2.4)         # metres covered by one tile (u, v)
BRICK_PX = 0.00125              # metres per pixel
BRICK_HMIN, BRICK_HMAX = -0.085, 0.012
SAND_TILE = 1.6
SAND_HMIN, SAND_HMAX = -0.03, 0.015
BLUE_TILE = 3.0
SILT_TILE = 2.5
RUST_TILE = 0.9
OAK_ATLAS_COLS = 8
OAK_PLANK_W = 0.25
OAK_ATLAS_H_M = 5.4

# Tide doors
DOOR_STRAPS_Y = [-4.75, -3.95, -3.15, -2.35, -1.6]   # strap centre heights (game y)
DOOR_OPEN_DEG = 40.0
