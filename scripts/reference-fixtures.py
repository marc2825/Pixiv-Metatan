"""Rebuild our synthetic fixtures using pinned upstream readers/writers, entirely locally.

No model, NovelAI account, cloud Inspect, ComfyUI server or Stable Diffusion WebUI is run.
Only small, unmodified functions/classes are executed with stub adapters for paths/settings.
External reference source is not copied into the extension or this repository.
All images are synthetic and generated here (black or seeded noise pixels).
"""
import argparse
import ast
import base64
import gzip
import hashlib
import json
import os
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace

import numpy as np
from PIL import Image, PngImagePlugin
from PIL.PngImagePlugin import PngInfo
import piexif
import piexif.helper

parser = argparse.ArgumentParser()
parser.add_argument('--source-dir', type=Path, required=True)
parser.add_argument('--output-dir', type=Path, default=Path('tests/reference/fixtures'))
args = parser.parse_args()
sources = args.source_dir.resolve()
output = args.output_dir.resolve()
output.mkdir(parents=True, exist_ok=True)
NOVELAI_COMMIT = '3428907ac7183d7e36d7cc39e8f46f6f35ce99c1'
COMFY_COMMIT = 'd07dff4565ea9804277fff8cdfa0c817e08c3d44'
A1111_COMMIT = '82a973c04367123ae98bd9abdf80d9eda9b910e2'  # v1.10.1
expected_hashes = {
    'nai_sig.py': '66716858e42c571987148e3d0e1218315ffe06fc821b7afc425956ed21d3c326',
    'nai_meta.py': '49fc35c2590fc63576a30d9394e45cb6ac41b372fe7ae6feb6ccb45cf418881c',
    'nai_meta_writer.py': '252eb0efdd85a7cf3d7614de63026304eb7b9dd54a2da902e693ca82f8f1ecec',
    'comfy_nodes.py': '4cfd9be3754f9dc25213febdf96b690d6e32007c2e539d37e799d82226d758c5',
    'comfy_ui.py': '339cc100b45208f83f119ca76f48050bf723aea3377003357e8928a7ef85d025',
    'a1111_images.py': 'c1370f739d0ec64d2798a4ad3aab65cc191b817bba390f7f260129fd3ab40586',
}
for name, expected in expected_hashes.items():
    if hashlib.sha256((sources / name).read_bytes()).hexdigest() != expected:
        raise ValueError('reference-source-hash-mismatch: ' + name)
sys.path.insert(0, str(sources))
# nai_meta_writer imports FEC helpers that are commented out in the pinned writer. Fail loudly if called.
sys.modules['nai_bch'] = ModuleType('nai_bch')
sys.modules['nai_bch'].fec_encode = lambda *a, **k: (_ for _ in ()).throw(RuntimeError('FEC is not used'))
import nai_sig
import nai_meta
import nai_meta_writer


def extract(path, cls_or_func, namespace, method=None):
    """Execute one unchanged top-level class/function (or a method body as a function)."""
    tree = ast.parse((sources / path).read_text())
    node = next(n for n in tree.body if isinstance(n, (ast.ClassDef, ast.FunctionDef)) and n.name == cls_or_func)
    if method:
        node = next(n for n in node.body if isinstance(n, ast.FunctionDef) and n.name == method)
        node.decorator_list = []
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(sources / path), 'exec'), namespace)
    return namespace[method or cls_or_func]


# --- ComfyUI SaveImage (PNG) -------------------------------------------------------------
namespace = {
    'folder_paths': SimpleNamespace(
        get_output_directory=lambda: str(output),
        get_save_image_path=lambda prefix, directory, width, height: (directory, 'comfy-saveimage', 1, '', prefix),
    ),
    'Image': Image, 'PngInfo': PngInfo, 'np': np, 'json': json, 'os': os,
    'args': SimpleNamespace(disable_metadata=False),
}
extract('comfy_nodes.py', 'SaveImage', namespace)
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
                 'officialSignatureValid': signature_valid, 'stealth': 'not-present'})
for name, fmt in [('no-metadata.png', 'PNG'), ('synthetic.jpg', 'JPEG')]:
    Image.new('RGB', (1, 1), (0, 0, 0)).save(output / name, format=fmt)
    rows.append({'file': name, 'generator': 'unknown', 'format': 'png' if fmt == 'PNG' else 'jpeg', 'status': 'no-metadata'})
image = Image.open(output / 'comfy-saveimage.png')
assert json.loads(image.text['prompt']) == graph and json.loads(image.text['workflow']) == workflow
rows.append({'file': 'comfy-saveimage.png', 'generator': 'comfyui', 'format': 'png', 'status': 'found', 'chunks': dict(image.text), 'stealth': 'not-present'})

# --- NovelAI stealth_pngcomp via the official writer, verified by the official reader -------
# V4 caption layout follows the official image API schema (V4ConditionInput). Synthetic values.
v4_details = {
    **details, 'cfg_rescale': 0.2,
    'v4_prompt': {'caption': {'base_caption': 'synthetic common prompt', 'char_captions': [
        {'char_caption': 'synthetic character one', 'centers': [{'x': 0.3, 'y': 0.5}]},
        {'char_caption': 'synthetic character two', 'centers': [{'x': 0.7, 'y': 0.5}]},
    ]}, 'use_coords': True, 'use_order': True},
    'v4_negative_prompt': {'caption': {'base_caption': 'synthetic negative', 'char_captions': [
        {'char_caption': 'synthetic character one negative', 'centers': [{'x': 0.3, 'y': 0.5}]},
        {'char_caption': '', 'centers': [{'x': 0.7, 'y': 0.5}]},
    ]}, 'legacy_uc': False},
}
v4_fields = {
    'prompt': 'synthetic common prompt', 'negative': 'synthetic negative', 'seed': '123', 'steps': '28', 'cfg rescale': '0.2',
    'character 1 prompt': 'synthetic character one', 'character 1 negative': 'synthetic character one negative',
    'character 1 position': '(0.3, 0.5)', 'character 2 prompt': 'synthetic character two', 'character 2 position': '(0.7, 0.5)',
}
def pattern(width, height):
    # Deterministic, filter-exercising synthetic pixels that still compress well.
    y, x = np.mgrid[0:height, 0:width]
    return np.stack([(x * 7 + y * 3) % 256, (x * 5 + y * 11) % 256, (x * y) % 256, (x * 13 + y * 29) % 256], axis=-1).astype(np.uint8)
for name, size, keep_text in [('novelai-stealth-only.png', (160, 48), False), ('novelai-v4-text-and-stealth.png', (128, 128), True)]:
    metadata = PngInfo()
    metadata.add_text('Title', 'AI generated image')
    metadata.add_text('Description', 'synthetic common prompt')
    metadata.add_text('Software', 'NovelAI')
    metadata.add_text('Source', 'synthetic test model')
    metadata.add_text('Comment', json.dumps(v4_details))
    pixels = pattern(*size)
    stego = nai_meta_writer.inject_data(Image.fromarray(pixels, 'RGBA'), metadata)
    path = output / name
    stego.save(path, 'PNG', pnginfo=metadata if keep_text else None)
    image = Image.open(path)
    official = nai_meta.extract_image_metadata(image)
    assert official['Software'] == 'NovelAI' and official['Comment']['v4_prompt'] == v4_details['v4_prompt']
    assert 'Title' not in official
    row = {'file': name, 'generator': 'novelai', 'format': 'png', 'status': 'found', 'stealth': 'found',
           'officialStealthKeys': sorted(official.keys()), 'fields': {**v4_fields, 'model': 'synthetic test model'}}
    if keep_text:
        row['chunks'] = dict(image.text)
    rows.append(row)
# A patterned RGBA image without a stealth payload: the official reader must fail to find the magic.
plain = output / 'rgba-pattern-no-stealth.png'
Image.fromarray(pattern(130, 64), 'RGBA').save(plain, 'PNG')
try:
    nai_meta.extract_image_metadata(Image.open(plain))
    official_accepted = True
except (AssertionError, UnicodeDecodeError):
    official_accepted = False
assert not official_accepted, 'official reader accepted a non-stealth image'
rows.append({'file': plain.name, 'generator': 'unknown', 'format': 'png', 'status': 'no-metadata', 'stealth': 'not-present'})

# --- AUTOMATIC1111 JPEG/WebP via unchanged save_image_with_geninfo/read_info_from_image ------
parameters = 'synthetic prompt, line one\nsecond line\nNegative prompt: synthetic negative\nSteps: 20, Sampler: DPM++ 2M, Schedule type: Karras, CFG scale: 7, Seed: 42, Size: 8x8, Model: "synthetic, model", Clip skip: 2, Version: v1.10.1'
a1111 = {'os': os, 'Image': Image, 'PngImagePlugin': PngImagePlugin, 'piexif': piexif, 'json': json,
         'opts': SimpleNamespace(enable_pnginfo=True, jpeg_quality=80, webp_lossless=False),
         'IGNORED_INFO_KEYS': {'jfif', 'jfif_version', 'jfif_unit', 'jfif_density', 'dpi', 'exif', 'loop', 'background', 'timestamp', 'duration', 'progressive', 'progression', 'icc_profile', 'chromaticity', 'photoshop'},
         'sd_samplers': SimpleNamespace(samplers_map={}), 'errors': SimpleNamespace(report=lambda *a, **k: None)}
save_with_geninfo = extract('a1111_images.py', 'save_image_with_geninfo', a1111)
read_info = extract('a1111_images.py', 'read_info_from_image', a1111)
for name in ('a1111-exif.jpg', 'a1111-exif.webp'):
    path = output / name
    save_with_geninfo(Image.new('RGB', (8, 8), (0, 0, 0)), parameters, str(path))
    geninfo, _ = read_info(Image.open(path))
    assert geninfo == parameters, (name, geninfo)
    rows.append({'file': name, 'generator': 'a1111-forge', 'format': 'jpeg' if name.endswith('.jpg') else 'webp', 'status': 'found',
                 'exifUserComment': parameters,
                 'fields': {'prompt': 'synthetic prompt, line one\nsecond line', 'negative': 'synthetic negative', 'steps': '20',
                            'sampler': 'DPM++ 2M', 'schedule type': 'Karras', 'cfg': '7', 'seed': '42', 'size': '8x8',
                            'model': 'synthetic, model', 'clip skip': '2', 'version': 'v1.10.1'}})

# --- ComfyUI WebP EXIF via unchanged ImageSaveHelper._create_webp_metadata ----------------
comfy_ns = {'json': json, 'args': SimpleNamespace(disable_metadata=False), 'PILImage': Image, 'ComfyNode': object}  # annotation-only stub
create_webp_metadata = extract('comfy_ui.py', 'ImageSaveHelper', comfy_ns, method='_create_webp_metadata')
frame = Image.new('RGB', (4, 4), (0, 0, 0))
exif = create_webp_metadata(frame, SimpleNamespace(hidden=SimpleNamespace(prompt=graph, extra_pnginfo={'workflow': workflow})))
path = output / 'comfy-exif.webp'
frame.save(path, save_all=True, duration=166, append_images=[], exif=exif, lossless=True, quality=80, method=4)  # as save_animated_webp
read_back = Image.open(path).getexif()
assert read_back[0x0110] == 'prompt:' + json.dumps(graph) and read_back[0x010F] == 'workflow:' + json.dumps(workflow)
rows.append({'file': path.name, 'generator': 'comfyui', 'format': 'webp', 'status': 'found',
             'fields': {'ComfyUI API prompt JSON': json.dumps(graph), 'ComfyUI workflow JSON': json.dumps(workflow)}})

report = {
    'schemaVersion': 2, 'mode': 'local-official-reference', 'images': 'synthetic-generated-by-us',
    'novelaiCommit': NOVELAI_COMMIT, 'comfyCommit': COMFY_COMMIT, 'a1111Commit': A1111_COMMIT,
    'novelaiApiSchema': {'url': 'https://image.novelai.net/docs/doc.json', 'sha256': '6c138b5980915a67cd90096b99979206372d184ba75afd86f2c3756730001415',
                         'used': 'RequestParameters.v4_prompt / v4_negative_prompt -> V4ConditionInput (schema only; not executed)'},
    'referenceSha256': expected_hashes, 'rows': rows,
    'limits': ['No real NovelAI generation or valid production signature', 'No NovelAI cloud Inspect',
               'V4 captions follow the official API schema, not a real NovelAI-generated image',
               'Only unchanged upstream save/read functions executed, not the ComfyUI server or WebUI'],
}
(output / 'expected.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'result': 'PASS', 'syntheticFixtures': len(rows), 'officialNovelaiReader': True, 'officialNovelaiStealthWriter': True,
                  'officialComfySaveImage': True, 'comfyWebpExif': True, 'a1111ExifRoundTrip': True, 'officialInvalidSignatureRejected': True}))
