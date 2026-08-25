// Streaming USBPcap (LINKTYPE_USBPCAP) parser that replaces the tshark subprocess:
//   tshark -Y "btatt.opcode == 0x1b" -T fields -E separator=| -e btatt.handle -e btatt.value
// Feed pcap bytes with push(); it returns "0x%04x|<lowercase hex>" lines for every
// ATT Handle Value Notification found in HCI ACL traffic, in capture order.

const PCAP_GLOBAL_HEADER_LEN = 24;
const PCAP_MAGIC_LITTLE_ENDIAN = 0xa1b2c3d4; // bytes d4 c3 b2 a1
const PCAP_MAGIC_BIG_ENDIAN = 0xd4c3b2a1; // bytes a1 b2 c3 d4 (rejected)
const PCAP_OFFSET_LINKTYPE = 20;
const LINKTYPE_USBPCAP = 249;

const PCAP_RECORD_HEADER_LEN = 16;
const MAX_RECORD_LEN = 0x1000000; // sanity bound, a larger incl_len means desync

// USBPcap packet header (USBPcapBuffer.h, little-endian):
//   0  headerLen u16   — whole header incl. transfer-specific bytes
//   2  irpId u64, 10 status u32, 14 function u16
//   16 info u8         — bit0: 1 = IN (device to host)
//   17 bus u16, 19 device u16, 21 endpoint u8, 22 transfer u8
//   23 dataLength u32  — payload bytes following the header
const USBPCAP_MIN_HEADER_LEN = 27;
const USBPCAP_OFFSET_INFO = 16;
const USBPCAP_OFFSET_TRANSFER = 22;
const USBPCAP_OFFSET_DATA_LENGTH = 23;
const USBPCAP_INFO_IN = 0x01;
const USBPCAP_TRANSFER_INTERRUPT = 1;
const USBPCAP_TRANSFER_BULK = 3;

// HCI ACL data packet: u16 handle|PB|BC, u16 data total length, payload.
// PB flag 0b10 = first/complete L2CAP fragment, 0b01 = continuation.
const HCI_ACL_HEADER_LEN = 4;
const HCI_PB_CONTINUATION = 0x01;

const L2CAP_HEADER_LEN = 4; // u16 length (SDU bytes after the header), u16 CID
const L2CAP_CID_ATT = 0x0004;
const ATT_OPCODE_HANDLE_VALUE_NOTIFICATION = 0x1b;
const ATT_NOTIFICATION_MIN_LEN = 3; // opcode + handle

function parseGlobalHeader(header) {
  const magic = header.readUInt32LE(0);
  if (magic === PCAP_MAGIC_BIG_ENDIAN) {
    throw new Error("usbpcap-att-parser: big-endian pcap is not supported");
  }
  if (magic !== PCAP_MAGIC_LITTLE_ENDIAN) {
    throw new Error(`usbpcap-att-parser: bad pcap magic 0x${magic.toString(16).padStart(8, "0")}`);
  }
  const linktype = header.readUInt32LE(PCAP_OFFSET_LINKTYPE);
  if (linktype !== LINKTYPE_USBPCAP) {
    throw new Error(`usbpcap-att-parser: unsupported linktype ${linktype} (expected ${LINKTYPE_USBPCAP} LINKTYPE_USBPCAP)`);
  }
}

function parseAttNotificationLine(l2capPdu) {
  const sduLength = l2capPdu.readUInt16LE(0);
  if (l2capPdu.readUInt16LE(2) !== L2CAP_CID_ATT) {
    return null;
  }
  if (sduLength < ATT_NOTIFICATION_MIN_LEN || L2CAP_HEADER_LEN + sduLength > l2capPdu.length) {
    return null;
  }
  const att = l2capPdu.subarray(L2CAP_HEADER_LEN, L2CAP_HEADER_LEN + sduLength);
  if (att[0] !== ATT_OPCODE_HANDLE_VALUE_NOTIFICATION) {
    return null;
  }
  const handle = att.readUInt16LE(1);
  const value = att.subarray(ATT_NOTIFICATION_MIN_LEN);
  return `0x${handle.toString(16).padStart(4, "0")}|${value.toString("hex")}`;
}

export class UsbPcapAttLineParser {
  #buffer = Buffer.alloc(0); // consolidated parse buffer
  #offset = 0; // consumed prefix of #buffer
  #chunks = []; // pushed chunks not yet consolidated
  #pending = 0; // total bytes held in #chunks
  #headerParsed = false;
  #ended = false;
  #fragments = new Map(); // HCI connection handle -> partial L2CAP packet

  push(chunk) {
    if (this.#ended) {
      throw new Error("usbpcap-att-parser: push() after end()");
    }
    if (!Buffer.isBuffer(chunk)) {
      chunk = Buffer.from(chunk);
    }
    if (chunk.length === 0) {
      return [];
    }
    this.#chunks.push(chunk);
    this.#pending += chunk.length;
    const lines = [];
    this.#drain(lines);
    return lines;
  }

  end() {
    if (this.#ended) {
      return [];
    }
    this.#ended = true;
    const leftover = this.#buffer.length - this.#offset + this.#pending;
    if (!this.#headerParsed && leftover > 0) {
      throw new Error(
        `usbpcap-att-parser: truncated pcap global header (${leftover} of ${PCAP_GLOBAL_HEADER_LEN} bytes)`
      );
    }
    // Incomplete trailing records or L2CAP fragments are dropped, same as tshark on a closing pipe.
    this.#buffer = Buffer.alloc(0);
    this.#offset = 0;
    this.#chunks = [];
    this.#pending = 0;
    this.#fragments.clear();
    return [];
  }

  #drain(lines) {
    for (;;) {
      if (!this.#headerParsed) {
        const header = this.#peek(PCAP_GLOBAL_HEADER_LEN);
        if (!header) {
          return;
        }
        parseGlobalHeader(header); // throws on bad magic / unsupported linktype
        this.#headerParsed = true;
        this.#skip(PCAP_GLOBAL_HEADER_LEN);
        continue;
      }

      const recordHeader = this.#peek(PCAP_RECORD_HEADER_LEN);
      if (!recordHeader) {
        return;
      }
      const inclLen = recordHeader.readUInt32LE(8);
      if (inclLen <= 0 || inclLen > MAX_RECORD_LEN) {
        throw new Error(`usbpcap-att-parser: implausible pcap record length ${inclLen} (stream desync?)`);
      }
      const record = this.#peek(PCAP_RECORD_HEADER_LEN + inclLen);
      if (!record) {
        return;
      }
      this.#skip(PCAP_RECORD_HEADER_LEN + inclLen);
      try {
        const line = this.#parsePacket(record.subarray(PCAP_RECORD_HEADER_LEN));
        if (line !== null) {
          lines.push(line);
        }
      } catch {
        // A single corrupted packet must not kill the stream.
      }
    }
  }

  // Returns the next `size` bytes without consuming them, or null when more data is needed.
  #peek(size) {
    const available = this.#buffer.length - this.#offset;
    if (available >= size) {
      return this.#buffer.subarray(this.#offset, this.#offset + size);
    }
    if (available + this.#pending < size) {
      return null;
    }
    this.#consolidate();
    return this.#buffer.length >= size ? this.#buffer.subarray(0, size) : null;
  }

  #skip(size) {
    this.#offset += size;
    if (this.#offset === this.#buffer.length) {
      this.#buffer = Buffer.alloc(0);
      this.#offset = 0;
    }
  }

  #consolidate() {
    const parts = [];
    if (this.#offset < this.#buffer.length) {
      parts.push(this.#buffer.subarray(this.#offset));
    }
    parts.push(...this.#chunks);
    this.#buffer = parts.length === 1 ? parts[0] : Buffer.concat(parts);
    this.#chunks = [];
    this.#pending = 0;
    this.#offset = 0;
  }

  #parsePacket(packet) {
    if (packet.length < USBPCAP_MIN_HEADER_LEN) {
      return null;
    }
    const headerLen = packet.readUInt16LE(0);
    if (headerLen < USBPCAP_MIN_HEADER_LEN || headerLen > packet.length) {
      return null;
    }
    const transfer = packet[USBPCAP_OFFSET_TRANSFER];
    if (transfer !== USBPCAP_TRANSFER_BULK && transfer !== USBPCAP_TRANSFER_INTERRUPT) {
      return null;
    }
    if ((packet[USBPCAP_OFFSET_INFO] & USBPCAP_INFO_IN) === 0) {
      return null;
    }
    const dataLength = packet.readUInt32LE(USBPCAP_OFFSET_DATA_LENGTH);
    if (dataLength === 0 || headerLen + dataLength > packet.length) {
      return null;
    }
    const data = packet.subarray(headerLen, headerLen + dataLength);
    if (data.length < HCI_ACL_HEADER_LEN + L2CAP_HEADER_LEN) {
      return null;
    }
    return this.#parseAcl(data);
  }

  #parseAcl(data) {
    const handleFlags = data.readUInt16LE(0);
    const connectionHandle = handleFlags & 0x0fff;
    const pbFlag = (handleFlags >> 12) & 0x03;
    const aclLength = data.readUInt16LE(2);
    if (HCI_ACL_HEADER_LEN + aclLength > data.length) {
      return null;
    }
    const payload = data.subarray(HCI_ACL_HEADER_LEN, HCI_ACL_HEADER_LEN + aclLength);

    let l2cap;
    if (pbFlag === HCI_PB_CONTINUATION) {
      const partial = this.#fragments.get(connectionHandle);
      if (!partial) {
        return null; // orphan continuation fragment
      }
      l2cap = Buffer.concat([partial, payload]);
    } else {
      l2cap = payload; // first fragment starts a fresh PDU, dropping any stale partial
    }

    if (l2cap.length < L2CAP_HEADER_LEN) {
      this.#fragments.set(connectionHandle, l2cap);
      return null;
    }
    const totalLength = L2CAP_HEADER_LEN + l2cap.readUInt16LE(0);
    if (l2cap.length < totalLength) {
      this.#fragments.set(connectionHandle, l2cap);
      return null;
    }
    this.#fragments.delete(connectionHandle);
    return parseAttNotificationLine(l2cap.subarray(0, totalLength));
  }
}
