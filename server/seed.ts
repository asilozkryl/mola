import { randomUUID } from 'node:crypto';
import { Repository } from './db.js';

const colors = ['#e9c487', '#b6aceb', '#d4a890', '#a1c2b5', '#d8a4c4'];

export function createWorkspace(repo: Repository, { name, userName, email, passwordHash, demo = false }: { name: string; userName: string; email: string; passwordHash: string | null; demo?: boolean }) {
  const workspaceId = randomUUID();
  const userId = randomUUID();
  const now = new Date().toISOString();
  repo.run('INSERT INTO workspaces (id,name,is_demo,created_at) VALUES (?,?,?,?)', workspaceId, name, demo ? 1 : 0, now);
  repo.run('INSERT INTO users (id,workspace_id,name,email,password_hash,color,role,status,created_at,email_verified) VALUES (?,?,?,?,?,?,?,?,?,?)', userId, workspaceId, userName, email, passwordHash, colors[0], 'owner', '', now, demo ? 1 : 0);
  const channelNames = demo ? ['genel', 'tasarım', 'ürün', 'geliştirme', 'ilham', 'duyurular'] : ['genel', 'duyurular'];
  const descriptions: Record<string, string> = { genel: 'Ekibin buluşma noktası. Fikirler, gelişmeler ve güzel bir merhaba.', tasarım: 'Birlikte daha iyisini tasarlıyoruz. Fikirler, geri bildirimler ve küçük detaylar.', ürün: 'Kullanıcılarımız için bir sonraki güzel adım.', geliştirme: 'Kod, teknik kararlar ve birlikte çözdüğümüz problemler.', ilham: 'Görünce paylaşmadan duramadıklarımız.', duyurular: 'Ekipten haberler ve önemli güncellemeler.' };
  const channels: Record<string, string> = {};
  for (const channelName of channelNames) {
    const id = randomUUID(); channels[channelName] = id;
    repo.run('INSERT INTO channels (id,workspace_id,name,description,kind,created_at) VALUES (?,?,?,?,?,?)', id, workspaceId, channelName, descriptions[channelName], 'text', now);
  }
  for (const voiceName of ['Tasarım odası', 'Kahve molası']) repo.run('INSERT INTO channels (id,workspace_id,name,description,kind,created_at) VALUES (?,?,?,?,?,?)', randomUUID(), workspaceId, voiceName, voiceName === 'Tasarım odası' ? 'Ekranını paylaş, birlikte düşünelim.' : 'Bir fincan kahve ve biraz sohbet.', 'voice', now);
  if (!demo) return { workspaceId, userId };

  const names = ['Ayşe Demir', 'Deniz Arslan', 'Selin Kaya', 'Mert Yılmaz'];
  const memberIds = names.map((memberName, index) => {
    const id = randomUUID();
    repo.run('INSERT INTO users (id,workspace_id,name,email,password_hash,color,role,status,created_at,email_verified) VALUES (?,?,?,?,?,?,?,?,?,?)', id, workspaceId, memberName, `demo-${id}@example.invalid`, null, colors[index + 1], 'member', ['Tasarımda küçük detaylar ✨', 'Bir fikrim var 💡', 'Odaklanıyorum 🎧', 'Yeni şeyler inşa ediyorum 🚀'][index], now, 1);
    return id;
  });
  // Fictional workspace content; only real socket connections determine presence.
  let minutesAgo = 155;
  const message = (channel: string, author: number, content: string, pinned = false, parentId: string | null = null) => {
    const id = randomUUID();
    const date = new Date(Date.now() - minutesAgo * 60_000).toISOString(); minutesAgo -= 8;
    repo.run('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)', id, channels[channel], author === -1 ? userId : memberIds[author], content, date, null, parentId, pinned ? 1 : 0);
    return id;
  };
  message('genel', 0, 'Günaydın ekip! ☀️ Yeni bir hafta, yeni fikirler. Bu hafta herkesin üzerinde çalıştığı en heyecan verici şey ne?');
  message('genel', 3, 'Ben bildirim deneyimini toparlıyorum. Daha sakin, daha anlamlı bir akış geliyor.');
  message('genel', 2, 'Kullanıcı görüşmelerinden çok güzel notlarla döndüm. Öğleden sonra ürün kanalında paylaşacağım 💬');
  message('genel', -1, 'Harika! Bugün tasarım odasında buluşalım, yeni akışı birlikte gözden geçirelim.');
  message('tasarım', 0, 'Günaydın tasarım ekibi! ☀️\nYeni çalışma alanı deneyiminin ilk taslakları hazır. Bu turda özellikle sadeliğe ve herkesin aradığını kolayca bulmasına odaklandım.');
  const brief = message('tasarım', 0, 'Bu haftanın tasarım odağı\n\n✦ Daha ferah bir mesajlaşma deneyimi\n✦ Tek tıkla sesli görüşme ve ekran paylaşımı\n✦ Küçük ama işimizi kolaylaştıran detaylar\n\nGeri bildirimlerinizi bu mesajın altında toplayalım. 💛', true);
  repo.run('INSERT INTO reactions VALUES (?,?,?)', brief, memberIds[1], '💛');
  repo.run('INSERT INTO reactions VALUES (?,?,?)', brief, memberIds[2], '💛');
  repo.run('INSERT INTO reactions VALUES (?,?,?)', brief, userId, '✨');
  message('tasarım', 1, 'Bu yönü çok sevdim. Özellikle kanal içinden görüşmeye geçişi ne kadar kolay yaparsak o kadar iyi. 🙌', false, brief);
  message('tasarım', 0, 'Kesinlikle! Görüşme kontrollerini hep ulaşılabilir tutacağım.', false, brief);
  message('tasarım', 2, 'Kullanıcı görüşmelerinde de en çok bu çıktı: “Konuşmaya devam edelim ama ekranımı da göstereyim.” Akışı bölmeden çözmek çok değerli.');
  message('tasarım', 3, 'Teknik tarafı da hazırladım. Mikrofon, kamera ve ekran paylaşımını aynı odada deneyebiliriz. Hazır olduğunuzda haber verin 🚀');
  const last = message('tasarım', 0, 'Küçük bir tasarım molası? ☕\nSaat 14.30’da tasarım odasında buluşup birlikte bakalım. Asil, senin de düşüncelerini duymak isterim!');
  repo.run('INSERT INTO reactions VALUES (?,?,?)', last, memberIds[1], '🙌');
  repo.run('INSERT INTO reactions VALUES (?,?,?)', last, memberIds[3], '🙌');
  message('ürün', 2, 'Bu hafta üç kullanıcı görüşmemiz var. Amacımız ekiplerin mesajlaşma ve toplantı arasındaki geçişini anlamak. Notları burada birlikte değerlendirelim.');
  message('ürün', 1, 'Öneri: her yeni özellik için “bir tık daha az” sorusunu soralım. Küçük kazanımlar büyük fark yaratıyor.');
  message('geliştirme', 3, 'Geliştirme notları 🛠️\nMesajlar anlık olarak iletiliyor. Görüşmelerde bağlantı izinleri ve cihaz seçimini birlikte test edebiliriz.');
  message('ilham', 0, 'İyi tasarım bazen daha fazla eklemek değil, gereksiz olanı nazikçe kaldırmak. Bugünün notu ✨');
  message('duyurular', -1, 'Mola’ya hoş geldiniz! 👋\n\nBurası ekibimizin ortak alanı. Kanallarda fikirlerinizi paylaşın, bir görüşme başlatın ve ekranınızı paylaşarak birlikte üretin.\n\nBu bir örnek çalışma alanıdır. Gerçek ekibiniz için giriş ekranından kendi alanınızı oluşturabilirsiniz.', true);
  return { workspaceId, userId };
}
