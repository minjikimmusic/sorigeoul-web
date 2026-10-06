import json
import os
from server import compare, dummy, feedback
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, 'data')

def load_reference(role, song_id):
    p = os.path.join(DATA_DIR, role, f'{song_id}.json')
    if not os.path.exists(p):
        return None
    with open(p, encoding='utf-8') as f:
        return json.load(f)

def with_feedback(result, song_id, expert):
    expert = expert if expert else dummy.expert_result(song_id)
    result['feedback'], result['feedback_basis'] = feedback.select(song_id, result.get('segments'), expert.get('segments'), result.get('source', {}).get('sigimsae_diagnostics'))
    result['comparison'] = compare.compare(song_id, expert, result)
    result['expert_dummy'] = bool(expert.get('dummy'))
    return result
