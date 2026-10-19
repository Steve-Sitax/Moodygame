# Managed heap candidate: unfinished
Preserved changes: 055d2fd7 and 9b247cc8; #181, #62 and #205 remain open.
Memory occupancy improved, but exact pixel equivalence and pause nonregression are unproved.
The unchanged baseline also shows an optimization-mode pixel mismatch; isolate mirror/visibility switches first.
Keep this candidate off main until exact pixels and exclusive pause measurements pass.
