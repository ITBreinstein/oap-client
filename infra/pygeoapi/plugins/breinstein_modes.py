# =================================================================
#
# Two pygeoapi processes that allow one execution mode each, for the
# oap-client contract lane and the web client's mode selection.
#
# Why these exist
# ---------------
# A client must choose between synchronous and asynchronous execution from
# the process's `jobControlOptions`, and the web client does: it offers the
# choice only when both are allowed, and otherwise runs the one mode there is
# (apps/web/src/app/ProcessScreen.tsx, workflow.ts). But every process on the
# pinned pygeoapi allows both, so that logic had never met a live server.
#
# `breinstein-async-only` declares `["async-execute"]` and
# `breinstein-sync-only` declares `["sync-execute"]`. Both are `slow`
# otherwise — the same inputs, the same output, the same sleep — so the only
# thing a test sees change is the declared mode. What pygeoapi does when a
# client asks for the mode a process does not declare is pygeoapi's to
# decide; that is the measurement.
#
# Deliberately not specific to any use case: they sleep and echo, as `slow`
# does. See the "no use case of our own" rule in the agent notes.
#
# MIT, same as the rest of the repository.
#
# =================================================================

import copy

from breinstein_slow import PROCESS_METADATA as SLOW_METADATA
from breinstein_slow import SlowProcessor


def _metadata(process_id, title, modes, why):
    metadata = copy.deepcopy(SLOW_METADATA)
    metadata['id'] = process_id
    metadata['title'] = {'en': title}
    metadata['description'] = {
        'en': 'Sleeps for a configurable number of seconds and then returns '
              f'a small JSON output, as "slow" does. {why}'
    }
    metadata['jobControlOptions'] = modes
    metadata['keywords'] = ['slow', 'sleep', 'execution mode', 'testbed']
    metadata['example'] = {'inputs': {'seconds': 1}}
    return metadata


ASYNC_ONLY_METADATA = _metadata(
    'breinstein-async-only',
    'Slow process, background only',
    ['async-execute'],
    'Declares asynchronous execution only, so a client has no choice to '
    'offer.')

SYNC_ONLY_METADATA = _metadata(
    'breinstein-sync-only',
    'Slow process, foreground only',
    ['sync-execute'],
    'Declares synchronous execution only, so a client has no choice to '
    'offer.')


class AsyncOnlyProcessor(SlowProcessor):
    """`slow`, declaring asynchronous execution only."""

    def __init__(self, processor_def):
        super().__init__(processor_def)
        # BaseProcessor keeps the description it was given; replace it with
        # ours after SlowProcessor has set everything else up.
        self.metadata = ASYNC_ONLY_METADATA

    def __repr__(self):
        return f'<AsyncOnlyProcessor> {self.name}'


class SyncOnlyProcessor(SlowProcessor):
    """`slow`, declaring synchronous execution only."""

    def __init__(self, processor_def):
        super().__init__(processor_def)
        self.metadata = SYNC_ONLY_METADATA

    def __repr__(self):
        return f'<SyncOnlyProcessor> {self.name}'
