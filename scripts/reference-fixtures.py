"""Rebuild our synthetic PNGs using pinned official readers/writers, entirely locally.
No model, NovelAI account, cloud Inspect or ComfyUI server is used.
External reference source is not copied into the extension or this repository.
"""
import argparse
import ast
import base64
import hashlib
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace

import numpy as np
from PIL import Image
from PIL.PngImagePlugin import PngInfo

parser = argparse.ArgumentParser()
parser.add_argument('--source-dir', type=Path, required=True)
parser.add_argument('--output-dir', type=Path, default=Path('tests/reference/fixtures'))
args = parser.parse_args()
sources = args.source_dir.resolve()
output = args.output_dir.resolve()
output.mkdir(parents=True, exist_ok=True)
expected_hashes = {
    'nai_sig.py': '66716858e42c571987148e3d0e1218315ffe06fc821b7afc425956ed21d3c326',
    'nai_meta.py': '49fc35c2590fc63576a30d9394e45cb6ac41b372fe7ae6feb6ccb45cf418881c',
    'comfy_nodes.py': '4cfd9be3754f9dc25213febdf96b690d6e32007c2e539d37e799d82226d758c5',
}
for name, expected in expected_hashes.items():
    if hashlib.sha256((sources / name).read_bytes()).hexdigest() != expected:
        raise ValueError('reference-source-hash-mismatch: ' + name)
sys.path.insert(0, str(sources))
import nai_sig

# Execute just the unchanged official SaveImage class, supplying tensor and output
# directory adapters. We do not import the full model/server dependencies.
source = (sources / 'comfy_nodes.py').read_text()
save_image = next(node for node in ast.parse(source).body if isinstance(node, ast.ClassDef) and node.name == 'SaveImage')
namespace = {
    'folder_paths': SimpleNamespace(
        get_output_directory=lambda: str(output),
        get_save_image_path=lambda prefix, directory, width, height: (directory, 'comfy-saveimage', 1, '', prefix),
    ),
    'Image': Image, 'PngInfo': PngInfo, 'np': np, 'json': json, 'os': os,
    'args': SimpleNamespace(disable_metadata=False),
}
exec(compile(ast.Module(body=[save_image], type_ignores=[]), str(sources / 'comfy_nodes.py'), 'exec'), namespace)
class SyntheticTensor:
    shape = (1, 1, 3)
    def cpu(self): return self
    def numpy(self): return np.zeros(self.shape, dtype=np.float32)
graph = {'1': {'class_type': 'CLIPTextEncode', 'inputs': {'text': 'synthetic cat', 'clip': ['2', 1]}}, '2': {'class_type': 'CheckpointLoaderSimple', 'inputs': {'ckpt_name': 'synthetic-test-only'}}}
workflow = {'nodes': [{'id': 1, 'type': 'CLIPTextEncode', 'widgets_values': ['synthetic cat']}], 'links': []}
writer = namespace['SaveImage']()
saved = writer.save_images([SyntheticTensor()], prompt=graph, extra_pnginfo={'workflow': workflow})
comfy_path = output / saved['ui']['images'][0]['filename']
comfy_path.rename(output / 'comfy-saveimage.png')

rows = []
details = {'prompt': 'synthetic common prompt', 'uc': 'synthetic negative', 'seed': 123, 'steps': 28, 'sampler': 'k_euler', 'scale': 5}
for name, comment in [
    ('novelai-normal', json.dumps(details)),
    ('novelai-wrapped-comment', json.dumps({'Comment': json.dumps(details)})),
    ('novelai-invalid-signature', json.dumps({**details, 'signed_hash': base64.b64encode(bytes(64)).decode('ascii')})),
]:
    metadata = PngInfo()
    metadata.add_text('Software', 'NovelAI')
    metadata.add_text('Description', 'synthetic description')
    metadata.add_text('Comment', comment)
    path = output / (name + '.png')
    Image.new('RGBA', (1, 1), (0, 0, 0, 255)).save(path, pnginfo=metadata)
    image = Image.open(path)
    reference = nai_sig.extract_png_text_metadata(image)
    decoded = reference.decoded_comment
    assert decoded['seed'] == 123 and decoded['uc'] == details['uc']
    signature_valid = None
    if 'signed_hash' in decoded:
        signature_valid = nai_sig.verify_metadata_is_novelai(image, np.array(image), reference)
        assert signature_valid is False
    rows.append({'file': path.name, 'generator': 'novelai', 'format': 'png', 'status': 'found', 'chunks': dict(image.text),
                 'fields': {'prompt': decoded['prompt'], 'negative': decoded['uc'], 'seed': str(decoded['seed']), 'steps': str(decoded['steps'])},
                 'officialSignatureValid': signature_valid})
for name, fmt in [('no-metadata.png', 'PNG'), ('synthetic.jpg', 'JPEG')]:
    Image.new('RGB', (1, 1), (0, 0, 0)).save(output / name, format=fmt)
    rows.append({'file': name, 'generator': 'unknown', 'format': 'png' if fmt == 'PNG' else 'jpeg', 'status': 'no-metadata' if fmt == 'PNG' else 'unsupported-format'})
image = Image.open(output / 'comfy-saveimage.png')
assert json.loads(image.text['prompt']) == graph and json.loads(image.text['workflow']) == workflow
rows.append({'file': 'comfy-saveimage.png', 'generator': 'comfyui', 'format': 'png', 'status': 'found', 'chunks': dict(image.text)})
report = {
    'schemaVersion': 1, 'mode': 'local-official-reference', 'images': 'synthetic-1x1-generated-by-us',
    'novelaiCommit': '3428907ac7183d7e36d7cc39e8f46f6f35ce99c1',
    'comfyCommit': 'd07dff4565ea9804277fff8cdfa0c817e08c3d44',
    'referenceSha256': expected_hashes, 'rows': rows,
    'limits': ['No real NovelAI generation or valid production signature', 'No NovelAI cloud Inspect', 'Only official ComfyUI SaveImage class executed, not the ComfyUI server'],
}
(output / 'expected.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'result': 'PASS', 'syntheticFixtures': len(rows), 'officialNovelaiReader': True, 'officialComfySaveImage': True, 'officialInvalidSignatureRejected': True}))
