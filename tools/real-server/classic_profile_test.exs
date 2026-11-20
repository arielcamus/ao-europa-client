# Byte-exact audit of EVERY client-decoded packet emitted by the pinned port.
# Expected bytes come from the independent C++ oracle, not either encoder.
ExUnit.start()
System.put_env("AO_PROTOCOL_PROFILE", "classic")

defmodule ClassicProfileTest do
  use ExUnit.Case, async: false
  alias AoTcpGateway.ClassicProfile, as: P
  alias AoProtocol.Server.Encoder

  @goldens System.fetch_env!("AO_CLIENT_ROOT")
           |> Path.join("packages/protocol/test/goldens.json")
           |> File.read!()
           |> Jason.decode!()
  defp golden(key), do: Base.decode16!(@goldens[key], case: :mixed)

  test "classic input frames match the C++ oracle and preserve coalesced data" do
    assert {:ok, {:classic_login_account, %{username: "a@b", password: "pñ"}}, <<>>} = P.decode(golden("LoginAccount"))
    assert {:ok, {:classic_login_character, %{id: 300, name: "Añ"}}, <<>>} = P.decode(golden("LoginExistingChar"))
    assert {:ok, {:walk, %{direction: :east, packet_count: 0x01020304}}, <<>>} = P.decode(golden("Walk"))
    assert {:ok, {:request_position_update, %{}}, <<>>} = P.decode(golden("RequestPositionUpdate"))
    second = golden("Walk")
    assert {:ok, _, ^second} = P.decode(golden("LoginAccount") <> second)
    for key <- ["LoginAccount", "LoginExistingChar", "Walk", "RequestPositionUpdate"],
        length <- 0..(byte_size(golden(key)) - 1) do
      assert P.decode(binary_part(golden(key), 0, length)) == :incomplete
    end
  end

  test "invalid and unsupported complete input is rejected" do
    for bytes <- [<<1, 0>>, <<1, 32>>, <<2, 0, 255, 127>>,
                  <<7, 0, 78, 0, 0, 1, 0, 0, 0>>,
                  <<4, 0, 49, 1, 128, 128>>] do
      assert {:error, _} = P.decode(bytes)
    end
  end

  @character %{char_index: 0x1234, body_id: 200, head_id: 201, heading: 4, x: 50, y: 60,
      weapon_id: 202, shield_id: 203, helmet_id: 204, cart_id: 205, backpack_id: 206,
      fx: 207, fx_loops: -1, name: "Añ", status: 1, privileges: 128, particula_fx: 255,
      head_aura: "H", arma_aura: "W", body_aura: "B", dm_aura: "D", rm_aura: "R",
      otra_aura: "O", escudo_aura: "S", speed: 1.5, es_npc: 2, appear: 1,
      group_index: 0x102, clan_index: 0x304, clan_nivel: 5, min_hp: 1000, max_hp: 2000,
      min_mana: 3000, max_mana: 4000, simbolo: 6, idle: true, navegando: true,
      tipo_usuario: 7, team_captura: 8, tiene_bandera: 9, npc_num: 0x506}
  @intervals %{melee: 101, bow: 102, magic: 103, work_extract: 104,
      work_build: 105, walk: 300, drop: 107, use_item: 108, use_click: 109,
      melee_magic: 110, magic_melee: 111, melee_use: 112}
  @characters [
    %{id: 300, name: "Añ", body_id: 200, head_id: 128, class: "paladin", map_id: 257,
      pos_x: 50, pos_y: 51, level: 12, criminal: false},
    %{id: 2, name: "B", body_id: 1, head_id: 2, class: "warrior", map_id: 4,
      pos_x: 5, pos_y: 6, level: 7, criminal: true}
  ]
  # {client packet name, C++ golden name, real upstream command}
  @outgoing [
    {"Connected", "Connected", {:connected, %{}}},
    {"Logged", "Logged", {:logged, %{new_user: false}}},
    {"Disconnect", "Disconnect", {:disconnect, %{}}},
    {"UpdateSta", "UpdateSta", {:update_stamina, %{min_sta: 90}}},
    {"UpdateMana", "UpdateMana", {:update_mana, %{min_mana: 60}}},
    {"UpdateHP", "UpdateHP", {:update_hp, %{min_hp: 80, shield: 123456}}},
    {"UpdateGold", "UpdateGoldAdapter", {:update_gold, %{gold: 1200}}},
    {"UpdateExp", "UpdateExp", {:update_exp, %{current_xp: 25, next_xp: 200}}},
    {"ChangeMap", "ChangeMap", {:change_map, %{map_id: 257, version: 258}}},
    {"PosUpdate", "PosUpdate", {:pos_update, %{x: 200, y: 201}}},
    {"ConsoleMsg", "ConsoleMsgAdapter", {:console_msg, %{message: "Hola ñ", font_index: 2}}},
    {"CharacterCreate", "CharacterCreateAdapter", {:character_create, @character}},
    {"CharacterMove", "CharacterMove", {:character_move, %{char_index: 0x1234, x: 200, y: 201}}},
    {"UserCharIndexInServer", "UserCharIndexInServer", {:user_char_index_in_server, %{char_index: 0x1234}}},
    {"UpdateUserStats", "UpdateUserStats", {:update_user_stats, %{max_hp: 100, min_hp: 80,
      shield: 123456, max_mana: 80, min_mana: 60, max_sta: 100, min_sta: 90, gold: 1200,
      gold_cap: 1000, level: 12, exp_next_level: 200, exp: 25, class: 3}}},
    {"ChangeInventorySlot", "ChangeInventorySlot", {:change_inventory_slot, %{slot: 42,
      obj_index: 2, amount: 3, equipped: true, valor: 1.5, puede_usar: 1,
      elemental_tags: 0x01020304, is_bindable: false}}},
    {"ChangeSpellSlot", "ChangeSpellSlot", {:change_spell_slot, %{slot: 40, spell_id: 0}}},
    {"ErrorMsg", "ErrorMsg", {:error_msg, %{message: "No ñ"}}},
    {"UpdateHungerAndThirst", "UpdateHungerAndThirst", {:update_hunger_and_thirst,
      %{max_thirst: 100, min_thirst: 75, max_hunger: 100, min_hunger: 85}}},
    {"Intervals", "IntervalsAdapter", {:intervals, @intervals}},
    {"AccountCharacterList", "AccountCharacterListAdapter", {:classic_character_list, @characters}}
  ]

  for {name, key, command} <- @outgoing do
    @key key
    @command command
    test "VB6 outgoing table: #{name}" do
      assert P.wire(P.encode(@command)) == golden(@key)
    end
  end

  test "table covers the entire client decoder / upstream emitter intersection" do
    client = File.read!(Path.join(System.fetch_env!("AO_CLIENT_ROOT"), "packages/protocol/src/packets.ts"))
    [_, enum] = Regex.run(~r/export enum ServerPacketId \{([^}]+)\}/s, client)
    decoded = Map.new(Regex.scan(~r/(\w+) = (\d+)/, enum), fn [_, name, id] -> {name, String.to_integer(id)} end)
    upstream = Encoder.module_info(:compile)[:source] |> to_string() |> File.read!()
    emitted = Regex.scan(~r/PacketIds\.Server\.(\w+)\(\)/, upstream)
      |> Enum.map(fn [_, name] -> apply(AoProtocol.PacketIds.Server, String.to_existing_atom(name), []) end)
      |> MapSet.new() |> MapSet.put(199)
    audited = MapSet.new(@outgoing, fn {name, _, _} -> Map.fetch!(decoded, name) end)
    assert audited == MapSet.intersection(MapSet.new(Map.values(decoded)), emitted)
    # Explicitly document the only decoded IDs the pinned port never emits.
    assert MapSet.difference(MapSet.new(Map.values(decoded)), emitted) == MapSet.new([64, 186, 187])
    for {name, key, _} <- @outgoing do
      <<_length::little-16, id::little-signed-16, _::binary>> = golden(key)
      assert id == Map.fetch!(decoded, name)
    end
  end

  test "actual table output is accepted byte-exactly by PR #5's strict client decoder" do
    frames = Enum.map(@outgoing, fn {name, _, command} ->
      %{name: name, hex: Base.encode16(P.wire(P.encode(command)))}
    end)
    script = Path.join(System.fetch_env!("AO_CLIENT_ROOT"), "tools/real-server/verify-wire.mjs")
    {output, status} = System.cmd("node", [script, Jason.encode!(frames)], stderr_to_stdout: true)
    assert status == 0, output
    IO.puts(output)
  end

  test "UpdateExp preserves all signed Int32 bits and never sends next-level XP" do
    for xp <- [-2_147_483_648, -1, 0, 2_147_483_647], next <- [0, 123456, 2_147_483_647] do
      assert P.wire(P.encode({:update_exp, %{current_xp: xp, next_xp: next}})) == golden("UpdateExp:#{xp}")
    end
  end

  test "console UTF-8 byte lengths cross the varint boundary and keep the font" do
    for {key, message, font} <- [{"ConsoleMsgEmptyAdapter", "", 255},
                               {"ConsoleMsgLongAdapter", String.duplicate("ñ", 64), 2}] do
      assert P.wire(P.encode({:console_msg, %{message: message, font_index: font}})) == golden(key)
    end
  end

  test "upstream map version zero names the actual classic map resource" do
    assert P.wire(P.encode({:change_map, %{map_id: 257, version: 0}})) == <<6,0,30,0,1,1,1,1>>
  end

  test "default port protocol stays unchanged when the profile is off" do
    System.delete_env("AO_PROTOCOL_PROFILE")
    on_exit(fn -> System.put_env("AO_PROTOCOL_PROFILE", "classic") end)
    assert P.wire(<<1, 0>>) == <<1, 0>>
    assert P.decode(<<79, 0>>) == {:ok, {:request_position_update, %{}}, <<>>}
    for {name, _, command} <- @outgoing, name != "AccountCharacterList" do
      upstream = Encoder.encode(command)
      assert P.encode(command) == upstream
      assert P.wire(upstream) == upstream
    end
  end
end
