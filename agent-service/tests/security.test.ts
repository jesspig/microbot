/**
 * Security 模块测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  SensitiveDetector,
  KeyManager,
  EncryptionService,
  createSecurityContext,
} from '@micro-agent/sdk';

describe('SensitiveDetector', () => {
  let detector: SensitiveDetector;

  beforeEach(() => {
    detector = new SensitiveDetector();
  });

  describe('detect', () => {
    it('应检测 OpenAI API Key', () => {
      const text = 'My API key is sk-1234567890abcdefghijklmnop';
      const result = detector.detect(text);

      expect(result.hasSensitive).toBe(true);
      expect(result.types.has('api_key')).toBe(true);
      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.recommendation).toBe('encrypt');
    });

    it('应检测邮箱地址', () => {
      const text = 'Contact us at support@example.com';
      const result = detector.detect(text);

      expect(result.hasSensitive).toBe(true);
      expect(result.types.has('email')).toBe(true);
    });

    it('应检测中国手机号', () => {
      const text = '手机号是 13812345678';
      const result = detector.detect(text);

      expect(result.hasSensitive).toBe(true);
      expect(result.types.has('phone')).toBe(true);
    });

    it('应检测中国身份证号', () => {
      const text = '身份证号：110101199001011234';
      const result = detector.detect(text);

      expect(result.hasSensitive).toBe(true);
      expect(result.types.has('id_card')).toBe(true);
    });

    it('应检测 JWT Token', () => {
      const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      const result = detector.detect(text);

      expect(result.hasSensitive).toBe(true);
      expect(result.types.has('token')).toBe(true);
    });

    it('应检测密码字段', () => {
      const text = 'password: mysecretpassword123';
      const result = detector.detect(text);

      expect(result.hasSensitive).toBe(true);
      expect(result.types.has('password')).toBe(true);
    });

    it('无敏感信息时应返回空结果', () => {
      const text = '这是一段普通的文本，不包含任何敏感信息。';
      const result = detector.detect(text);

      expect(result.hasSensitive).toBe(false);
      expect(result.matches.length).toBe(0);
      expect(result.recommendation).toBe('none');
    });
  });

  describe('isFieldSensitive', () => {
    it('应识别敏感字段名', () => {
      expect(detector.isFieldSensitive('password')).toBe(true);
      expect(detector.isFieldSensitive('api_key')).toBe(true);
      expect(detector.isFieldSensitive('user_password')).toBe(true);
    });

    it('应忽略非敏感字段名', () => {
      expect(detector.isFieldSensitive('username')).toBe(false);
      expect(detector.isFieldSensitive('content')).toBe(false);
    });
  });

  describe('自定义规则', () => {
    it('应支持添加自定义规则', () => {
      detector.addRule({
        id: 'custom-secret',
        type: 'secret',
        pattern: 'CUSTOM-SECRET-[a-zA-Z0-9]+',
        description: 'Custom Secret Pattern',
        confidence: 0.95,
        enabled: true,
      });

      const text = 'Secret: CUSTOM-SECRET-abc123';
      const result = detector.detect(text);

      expect(result.hasSensitive).toBe(true);
      expect(result.types.has('secret')).toBe(true);
    });

    it('应支持移除规则', () => {
      detector.removeRule('email');

      const text = 'Email: test@example.com';
      const result = detector.detect(text);

      expect(result.types.has('email')).toBe(false);
    });
  });
});

describe('KeyManager', () => {
  let keyManager: KeyManager;

  beforeEach(() => {
    // 使用自动生成密钥（仅测试用）
    keyManager = new KeyManager({
      allowAutoGenerate: true,
    });
  });

  afterEach(async () => {
    await keyManager.close();
  });

  describe('initialize', () => {
    it('应成功初始化', async () => {
      await keyManager.initialize();
      const { key, keyId } = await keyManager.getCurrentKey();

      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
      expect(keyId).toMatch(/^key_/);
    });
  });

  describe('getCurrentKey', () => {
    it('应返回当前密钥', async () => {
      await keyManager.initialize();
      const { key, keyId } = await keyManager.getCurrentKey();

      expect(key).toBeDefined();
      expect(keyId).toBeDefined();
    });
  });

  describe('rotateKey', () => {
    it('应成功轮换密钥', async () => {
      await keyManager.initialize();
      const { keyId: oldKeyId } = await keyManager.getCurrentKey();

      const newKeyId = await keyManager.rotateKey();
      const { keyId: currentKeyId } = await keyManager.getCurrentKey();

      expect(newKeyId).not.toBe(oldKeyId);
      expect(currentKeyId).toBe(newKeyId);
    });

    it('应保留历史密钥', async () => {
      await keyManager.initialize();
      const { keyId: oldKeyId } = await keyManager.getCurrentKey();

      await keyManager.rotateKey();

      const oldKey = await keyManager.getKeyById(oldKeyId);
      expect(oldKey).toBeDefined();
    });
  });

  describe('getKeyInfos', () => {
    it('应返回密钥信息列表', async () => {
      await keyManager.initialize();
      const infos = await keyManager.getKeyInfos();

      expect(infos.length).toBe(1);
      expect(infos[0].active).toBe(true);
    });
  });

  describe('export/import', () => {
    it('应支持导出和导入密钥', async () => {
      await keyManager.initialize();
      const exportedKey = await keyManager.exportKey();

      const newManager = new KeyManager({ allowAutoGenerate: true });
      const importedKeyId = await newManager.importKey(exportedKey, 'env');

      expect(importedKeyId).toBeDefined();
      await newManager.close();
    });
  });
});

describe('EncryptionService', () => {
  let keyManager: KeyManager;
  let encryption: EncryptionService;

  beforeEach(async () => {
    keyManager = new KeyManager({ allowAutoGenerate: true });
    encryption = new EncryptionService(keyManager);
    await encryption.initialize();
  });

  afterEach(async () => {
    await encryption.close();
    await keyManager.close();
  });

  describe('encrypt/decrypt', () => {
    it('应正确加密和解密字符串', async () => {
      const plaintext = '这是一段需要加密的敏感信息';

      const encrypted = await encryption.encrypt(plaintext);
      const decrypted = await encryption.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
      expect(encrypted.keyId).toBeDefined();
      expect(encrypted.ciphertext).not.toBe(plaintext);
    });

    it('每次加密应生成不同的密文', async () => {
      const plaintext = '相同的内容';

      const encrypted1 = await encryption.encrypt(plaintext);
      const encrypted2 = await encryption.encrypt(plaintext);

      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
    });
  });

  describe('encryptFields/decryptFields', () => {
    it('应正确加密和解密对象字段', async () => {
      const obj = {
        name: '张三',
        password: 'secret123',
        email: 'test@example.com',
      };

      const encrypted = await encryption.encryptFields(obj, ['password', 'email']);
      expect(encryption.isEncrypted(encrypted.password)).toBe(true);
      expect(encryption.isEncrypted(encrypted.email)).toBe(true);
      expect(encrypted.name).toBe('张三');

      const decrypted = await encryption.decryptFields(encrypted);
      expect(decrypted.password).toBe('secret123');
      expect(decrypted.email).toBe('test@example.com');
    });
  });

  describe('encryptContent/decryptContent', () => {
    it('应正确加密和解密内容字符串', async () => {
      const content = '敏感内容：API Key 是 sk-1234567890';

      const encrypted = await encryption.encryptContent(content);
      expect(encrypted.startsWith('encrypted:')).toBe(true);

      const decrypted = await encryption.decryptContent(encrypted);
      expect(decrypted).toBe(content);
    });

    it('应识别加密内容', () => {
      expect(encryption.isContentEncrypted('encrypted:...')).toBe(true);
      expect(encryption.isContentEncrypted('plain text')).toBe(false);
    });
  });

  describe('批量操作', () => {
    it('应支持批量加密', async () => {
      const items = ['item1', 'item2', 'item3'];

      const encrypted = await encryption.encryptBatch(items);
      const decrypted = await encryption.decryptBatch(encrypted);

      expect(decrypted).toEqual(items);
    });
  });
});

describe('createSecurityContext', () => {
  it('应创建完整的安全上下文', async () => {
    const context = await createSecurityContext({
      allowAutoGenerateKey: true,
    });

    expect(context.detector).toBeInstanceOf(SensitiveDetector);
    expect(context.keyManager).toBeInstanceOf(KeyManager);
    expect(context.encryption).toBeInstanceOf(EncryptionService);

    // 测试完整流程
    const sensitiveText = 'API Key: sk-1234567890abcdefghijklmnop';
    const detection = context.detector.detect(sensitiveText);

    expect(detection.hasSensitive).toBe(true);

    if (detection.recommendation === 'encrypt') {
      const encrypted = await context.encryption.encrypt(sensitiveText);
      const decrypted = await context.encryption.decrypt(encrypted);
      expect(decrypted).toBe(sensitiveText);
    }

    // 清理
    await context.keyManager.close();
    await context.encryption.close();
  });
});
