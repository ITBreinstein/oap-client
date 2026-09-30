# Known bugs

Tests that reproduce bugs found in the review of 2026-09-30 and not fixed yet.
Each is marked `it.fails`, and its name starts with the finding's ID. The suite
passes while the bug is there. When a fix lands the test starts failing: turn
it into an ordinary test, move it beside the tests of the code it covers, and
delete it from here.

The tests here that are not marked `it.fails` are ordinary ones — paths that
work — kept beside the known bugs whose harness they share.
