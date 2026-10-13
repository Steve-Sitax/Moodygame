"""Copy shared animation accessors between our exports without resampling every clothing rig."""
import copy
import json
import struct


def read(path):
    with open(path, 'rb') as stream:
        raw = stream.read()
    magic, version, size = struct.unpack_from('<III', raw)
    if (magic, version, size) != (0x46546c67, 2, len(raw)):
        raise ValueError('Incomplete GLB: ' + str(path))
    length = struct.unpack_from('<I', raw, 12)[0]
    return json.loads(raw[20:20 + length]), raw[28 + length:]


def paths(doc):
    out = {}
    def visit(index, prefix):
        node = doc['nodes'][index]
        name = prefix + '/' + node.get('name', '')
        out[index] = name
        for child in node.get('children', []):
            visit(child, name)
    for root in doc['scenes'][doc.get('scene', 0)]['nodes']:
        visit(root, '')
    return out


def copy_into(destination, source):
    dst, binary = read(destination)
    src, original = read(source)
    old_paths = paths(src)
    new_nodes = {name: index for index, name in paths(dst).items()}
    out = bytearray(binary)
    views, accessors = {}, {}
    def view(index):
        if index in views:
            return views[index]
        data = copy.deepcopy(src['bufferViews'][index])
        offset = data.get('byteOffset', 0)
        out.extend(b'\0' * (-len(out) % 4))
        data['byteOffset'] = len(out); data['buffer'] = 0
        out.extend(original[offset:offset + data['byteLength']])
        mapped = views[index] = len(dst['bufferViews'])
        dst['bufferViews'].append(data)
        return mapped
    def accessor(index):
        if index in accessors:
            return accessors[index]
        data = copy.deepcopy(src['accessors'][index])
        if 'bufferView' in data:
            data['bufferView'] = view(data['bufferView'])
        if 'sparse' in data:
            for key in ('indices', 'values'):
                data['sparse'][key]['bufferView'] = view(data['sparse'][key]['bufferView'])
        mapped = accessors[index] = len(dst['accessors'])
        dst['accessors'].append(data)
        return mapped
    animations = []
    for animation in src.get('animations', []):
        channels, samplers, mapping = [], [], {}
        for channel in animation['channels']:
            old = channel['target'].get('node')
            if old not in old_paths or old_paths[old] not in new_nodes:
                continue
            index = channel['sampler']
            if index not in mapping:
                sampler = copy.deepcopy(animation['samplers'][index])
                sampler['input'] = accessor(sampler['input'])
                sampler['output'] = accessor(sampler['output'])
                mapping[index] = len(samplers); samplers.append(sampler)
            channel = copy.deepcopy(channel)
            channel['sampler'] = mapping[index]
            channel['target']['node'] = new_nodes[old_paths[old]]
            channels.append(channel)
        if channels:
            data = copy.deepcopy(animation)
            data['channels'] = channels; data['samplers'] = samplers
            animations.append(data)
    dst['animations'] = animations
    dst['buffers'] = [{'byteLength': len(out)}]
    raw = json.dumps(dst, separators=(',', ':')).encode()
    raw += b' ' * (-len(raw) % 4); out.extend(b'\0' * (-len(out) % 4))
    with open(destination, 'wb') as stream:
        stream.write(struct.pack('<III', 0x46546c67, 2, 28 + len(raw) + len(out)))
        stream.write(struct.pack('<II', len(raw), 0x4e4f534a)); stream.write(raw)
        stream.write(struct.pack('<II', len(out), 0x004e4942)); stream.write(out)
    return [a['name'] for a in animations]
