// Feature groups, work packages and the name-to-group rules for the coverage map.
// Groups are ordered by player value (lowest value last). First matching rule wins.
export const GROUPS = [
  ['core', 'Core movement / world / session'],
  ['chat', 'Chat'],
  ['combat', 'Combat'],
  ['spells', 'Spells'],
  ['items', 'Items / commerce (NPC shop, inventory)'],
  ['npcs', 'NPCs'],
  ['bank', 'Bank'],
  ['trade', 'Trade (player to player)'],
  ['party', 'Party'],
  ['guild', 'Guild / clan'],
  ['quests', 'Quests'],
  ['skills', 'Skills / training / stats'],
  ['crafting', 'Crafting (smith / carpenter / alchemy / tailor)'],
  ['work', 'Fishing / mining / lumber (work skills)'],
  ['options', 'Options / keybinds'],
  ['minimap', 'Minimap / world map'],
  ['extras', 'Events, battlegrounds, premium shop, remort, anti-cheat'],
  ['gm', 'GM / admin (lowest)'],
];

// Work packages. Each packet and form belongs to exactly one, so agents never overlap.
export const PACKAGES = [
  ['wp01', 'Core session, HUD and chat leftovers', 'Account create/select/delete, character create, loading screens, HUD stat updates, remaining chat packets'],
  ['wp02', 'World FX, environment and minimap', 'Light, weather, particles, sound, projectiles, auras, area changes, world map form'],
  ['wp03', 'Combat and spells completion', 'Attack, hit/miss messages, safe modes, stun/paralysis, spell info, hotkeys, macros'],
  ['wp04', 'Items and NPC commerce completion', 'Inventory moves, key ring, gamble, gold actions, amount prompts, skins'],
  ['wp05', 'NPCs, pets, trainers and travel', 'Pet commands, trainer list, NPC symbols, travel form, NPC context menus'],
  ['wp06', 'Bank and player trade', 'Bank vaults (item + gold + account), user-to-user trade window and chat'],
  ['wp07', 'Party and guild/clan', 'Group frame/invites, every guild form, proposals, news, elections'],
  ['wp08', 'Quests', 'Quest list/details/abandon, NPC quest markers'],
  ['wp09', 'Skills, training and stats', 'Skill allocation, level up, attributes, statistics forms, rest/meditate'],
  ['wp10', 'Crafting and work skills', 'Smith, carpenter, alchemy, tailor, crafting window, fishing, mining, lumber'],
  ['wp11', 'Options, keybinds and extras', 'Options forms, custom keys, hotkeys, events, battlegrounds, duels, premium shop, remort'],
  ['wp12', 'GM / admin (last)', 'All GM commands, GM panel, SOS, MOTD edit, debug'],
];

const r = (src) => new RegExp(`^(?:${src})$`, 'i');
// [regex on packet name (e prefix removed), group, package]
export const PACKET_RULES = [
  // GM first, because several GM names look like normal verbs.
  [r('GMMessage|showName|OnlineRoyalArmy|OnlineChaosLegion|GoNearby|comment|Where|CreaturesInMap|WarpMeToTarget|WarpChar|Silence|SOS\\w*|CleanSOS|GoToChar|invisible|GMPanel|RequestUserList|Working|Hiding|Jail|KillNPC|WarnUser|EditChar|RequestChar\\w+|ReviveChar|OnlineGM|OnlineMap|Forgive|Kick|Execute|BanChar|UnbanChar|NPCFollow|SummonChar|SpawnListRequest|SpawnCreature|SpawnListt|ResetNPCInventory|CleanWorld|ServerMessage|NickToIP|IPToNick|GuildOnlineMembers|Teleport\\w+|SetCharDescription|ForceMIDI\\w+|ForceWAVE\\w+|RoyalArmyMessage|ChaosLegionMessage|TalkAsNPC|DestroyAllItemsInArea|Accept\\w+CouncilMember|ItemsInTheFloor|MakeDumb\\w*|CouncilKick|SetTrigger|AskTrigger|GuildMemberList|GuildBan|CreateItem|DestroyItems|ChaosLegionKick|RoyalArmyKick|RemovePunishment|TileBlockedToggle|KillNPCNoRespawn|KillAllNearbyNPCs|ChangeMOTD|SetMOTD|SystemMessage|CreateNPC\\w*|ServerOpenToUsersToggle|RemoveCharFromGuild|AlterName|DoBackUp|ShowGuildMessages|ChangeMapInfo\\w*|ChangeMapSetting|SaveChars|ShowServerForm|KickAllChars|ChatColor|Ignored|CheckSlot|SetSpeed|GlobalOnOff|Promedio|GiveItem|QuestionGM|PossUser|BanCuenta|UnbanCuenta|CerrarCliente|BanTemporal|Consulta|GetMapInfo|ResetChar|ResetearPersonaje|RequestDebug|Genio|DonateGold|Reward|RoleMasterRequest|punishments|Denounce|Information|UpTime|MensajeUser|ForumPost|AddForumMsg|ShowForumForm|ShowSOSForm|ShowMOTDEditionForm|ShowGMPanelForm|UserNameList|UserOnline|DebugDataResponse|Privilegios|ShowPapiro|MarcaDeGMPack|Online|UpdateUserKey|GuardNotice'), 'gm', 'wp12'],
  // Events / extras
  [r('Ofer\\w+|CuentaRegresiva|Evento\\w*|CrearEvento|CrearTorneo|ComenzarTorneo|CancelarTorneo|CancelarEvento|StartEvent|CreateEvent|FinEvento|BusquedaTesoro|SubastaInfo|OfertaInicial|OfertaDeSubasta|Duel|AcceptDuel|CancelDuel|QuitDuel|Casarse|ReportLobbyList|RequestLobbyList|LobbyCommand|AntiCheat\\w*|AntiMacroMessage|LogMacroClickHechizo|MacroPossent|ModifyCastleWhiteList|InvasionInfo|BuyShopItem|ShopInit|ShopPjsInit|UpdateShopClienteCredits|PublicarPersonajeMAO|EventoFaccionario|FeatureToggle|LeaveFaction|MapPriceEntrance|Gamble|SendClientToggles|ChangeSkinSlot|CancelarExit|Participar|TransFerGold|Notificar\\w*|NotifyInventarioHechizos|GetInventarioHechizos|NotificarClienteSeguido|NotificarClienteCasteo'), 'extras', 'wp11'],
  // Chat
  [r('Talk|Yell|Whisper|GrupoMsg|GuildMessage|GuildOnline|CouncilMessage|FactionMessage|GlobalMessage|ChatOverHead|LocaleChatOverHead|ConsoleMsg|ConsoleFactionMessage|GuildChat|ConsoleCharText|LocaleMsg|TextOverChar|TextOverTile|TextCharDrop|RemoveDialogs|RemoveCharDialog|ShowMessageBox|CommerceRecieveChatMessage|CommerceSendChatMessage|ShowSignal|FlashScreen|RequestMOTD|Help'), 'chat', 'wp01'],
  // Combat
  [r('Attack|CharAtaca|CharSwing|NPCKillUser|BlockedWithShield\\w+|NPCHitUser|UserHittedByUser|UserHittedUser|ArmaMov|EscudoMov|SafeToggle|SafeModeOn|SafeModeOff|PartySafe\\w*|PartySafeToggle|ClanSeguro|SeguroClan|SeguroResu|LegionarySecure|CreateProjectile|StunStart|ParalizeOK|InmovilizadoOK|Stopped|Blind|BlindNoMore|Dumb|DumbNoMore|UpdateTrap|CharUpdateHP|CharUpdateMAN|DoAnimation|SetInvisible|Resucitate|Heal|UpdateCooldownType|SendSkillCdUpdate'), 'combat', 'wp03'],
  // Spells
  [r('CastSpell|SpellInfo|MoveSpell|UseSpellMacro|ChangeSpellSlot|CreateFX|BarFx|WorkRequestTarget'), 'spells', 'wp03'],
  // Bank
  [r('Bank\\w+|BankExtract\\w+|BovedaMoveItem|TraerBoveda|UpdateBankGld|ChangeBankSlot|CuentaExtractItem|CuentaDeposit|RequestAccountState|Goliath'), 'bank', 'wp06'],
  // Trade
  [r('UserCommerce\\w+|ChangeUserTradeSlot|ShowUserRequest'), 'trade', 'wp06'],
  // Commerce / items
  [r('CommerceBuy|CommerceSell|CommerceEnd|CommerceInit|CommerceStart|ChangeNPCInventorySlot|ChangeInventorySlot|InventoryUnlockSlots|UseItem|UseItemU|EquipItem|Drop|PickUp|ShowPickUpObj|Moveitem|DeleteItem|UseKey|ObjectCreate|ObjectDelete|FYA|UpdateRM|UpdateDM|UpdateHungerAndThirst|UseHKeySlot|SetHotkeySlot|UpdateGold'), 'items', 'wp04'],
  // Party
  [r('InvitarGrupo|ResponderPregunta|RequestGrupo|AbandonarGrupo|HecharDeGrupo|ActionOnGroupFrame|DatosGrupo|UpdateGroupInfo|ShowPregunta'), 'party', 'wp07'],
  // Guild
  [r('Guild\\w*|RequestGuild\\w+|CreateNewGuild|ClanCodexUpdate|guildList|guildNews|OfferDetails|AlianceProposalsList|PeaceProposalsList|CharacterInfo|GuildLeaderInfo|GuildDetails|ShowGuildFundationForm|ShowFundarClanForm|QuieroFundarClan|llamadadeclan|PosLLamadaDeClan|MarcaDeClanPack|GuildConfig'), 'guild', 'wp07'],
  // Quests
  [r('Quest\\w*|NpcQuestListSend|ObjQuestListSend|UpdateNPCSimbolo'), 'quests', 'wp08'],
  // Crafting
  [r('Craft\\w+|OpenCrafting|CraftingItem|CraftingCatalyst|CraftingResult|AddItemCrafting|RemoveItemCrafting|AddCatalyst|RemoveCatalyst|CraftItem|CloseCrafting|MoveCraftItem|Blacksmith\\w+|CarpenterObjects|ShowBlacksmithForm|ShowCarpenterForm|AlquimistaObj|ShowAlquimiaForm|SastreObj|ShowSastreForm'), 'crafting', 'wp10'],
  // Work (fishing, mining, lumber)
  [r('Work\\w*|MacroTrabajoToggle|FlagTrabajar|CompletarAccion|StartAutomatedAction|RepeatMacro|FinalizarPescaEspecial|RomperCania|PelearConPezEspecial|Pescar\\w*'), 'work', 'wp10'],
  // Skills
  [r('ModifySkills|Train|TrainList|TrainerCreatureList|RequestAtributes|RequestSkills|RequestMiniStats|RequestStats|Atributes|SendSkills|MiniStats|LevelUp|UpdateUserStats|UpdateExp|Rest|RestOK|Meditate|MeditateToggle|CantUseWhileMeditating|RequestAtributes'), 'skills', 'wp09'],
  // Options / keybinds
  [r('BindKeys|ChangeDescription'), 'options', 'wp11'],
  // Minimap / world map
  [r('ShowFrmMapa|ubicacion'), 'minimap', 'wp02'],
  // NPC / pets / travel
  [r('Pet\\w+|ViajarForm|CompletarViaje'), 'npcs', 'wp05'],
  // Map and clicks
  [r('LeftClick|DoubleClick'), 'core', 'wp01'],
  // World FX
  [r('BlockPosition|Light|LightToFloor|hora|PlayMIDI|PlayWave|PlayWaveStep|Particle\\w+|fxpiso|AuraToChar|SpeedToChar|RainToggle|NieveToggle|NieblaToggle|AreaChanged|PauseToggle'), 'core', 'wp02'],
  // Core session
  [r('Connected|logged|Disconnect|Quit|LoginExistingChar|LoginNewChar|LoginAccount|CreateAccount|DeleteCharacter|AccountCharacterList|MostrarCuenta|Walk|ChangeHeading|RequestPositionUpdate|ChangeMap|PosUpdate\\w*|Character\\w+|UserIndexInServer|UserCharIndexInServer|ForceCharMove|UpdateSta|UpdateMana|UpdateHP|UpdateGold|UpdateFlag|UpdateCharValue|UpdateTagAndStatus|ErrorMsg|Intervals|NavigateToggle|EquiteToggle|NadarToggle|VelocidadToggle|Contadores|CerrarleCliente|ShowFrmLogear|home|CharUpdate\\w*|Intervals|AnswerReset'), 'core', 'wp01'],
];

export function classifyPacket(name) {
  for (const [re, group, pkg] of PACKET_RULES) if (re.test(name)) return { group, pkg };
  return { group: 'core', pkg: 'wp01', unclassified: true };
}

// packages for forms are given by forms.json "group"; this maps group to default package.
export const GROUP_PACKAGE = {
  core: 'wp01', chat: 'wp01', combat: 'wp03', spells: 'wp03', items: 'wp04', npcs: 'wp05', bank: 'wp06', trade: 'wp06',
  party: 'wp07', guild: 'wp07', quests: 'wp08', skills: 'wp09', crafting: 'wp10', work: 'wp10', options: 'wp11',
  minimap: 'wp02', extras: 'wp11', gm: 'wp12',
};
