# Compare the adapter against independent C++ oracle bytes already in M1.
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

  test "common outgoing packets match independent classic goldens" do
    for {key, command} <- [
      {"Connected", {:connected, %{}}}, {"Logged", {:logged, %{new_user: false}}},
      {"Disconnect", {:disconnect, %{}}}, {"ErrorMsg", {:error_msg, %{message: "No ñ"}}},
      {"PosUpdate", {:pos_update, %{x: 200, y: 201}}},
      {"UserCharIndexInServer", {:user_char_index_in_server, %{char_index: 0x1234}}},
      {"ChangeMap", {:change_map, %{map_id: 257, version: 258}}}
    ] do
      assert P.wire(Encoder.encode(command)) == golden(key)
    end
    assert P.wire(Encoder.encode({:change_map, %{map_id: 1, version: 0}})) == <<6,0,30,0,1,0,1,0>>
  end

  test "all CharacterCreate fields survive conversion; absent alignment is neutral" do
    params = %{char_index: 0x1234, body_id: 200, head_id: 201, heading: 4, x: 50, y: 60,
      weapon_id: 202, shield_id: 203, helmet_id: 204, cart_id: 205, backpack_id: 206,
      fx: 207, fx_loops: -1, name: "Añ", status: 1, privileges: 128, particula_fx: 255,
      head_aura: "H", arma_aura: "W", body_aura: "B", dm_aura: "D", rm_aura: "R",
      otra_aura: "O", escudo_aura: "S", speed: 1.5, es_npc: 2, appear: 1,
      group_index: 0x102, clan_index: 0x304, clan_nivel: 5, min_hp: 1000, max_hp: 2000,
      min_mana: 3000, max_mana: 4000, simbolo: 6, idle: true, navegando: true,
      tipo_usuario: 7, team_captura: 8, tiene_bandera: 9, npc_num: 0x506}
    expected = golden("CharacterCreate")
    expected = binary_part(expected, 0, byte_size(expected) - 1) <> <<0>>
    assert P.wire(Encoder.encode({:character_create, params})) == expected
  end

  test "intervals are reordered, with the four unsupported timings explicitly zero" do
    command = {:intervals, %{melee: 101, bow: 102, magic: 103, work_extract: 104,
      work_build: 105, walk: 300, drop: 107, use_item: 108, use_click: 109,
      melee_magic: 110, magic_melee: 111, melee_use: 112}}
    expected = binary_part(golden("Intervals"), 0, 52) <> :binary.copy(<<0>>, 16)
    assert P.wire(Encoder.encode(command)) == expected
  end

  test "default port protocol stays unchanged when the profile is off" do
    System.delete_env("AO_PROTOCOL_PROFILE")
    on_exit(fn -> System.put_env("AO_PROTOCOL_PROFILE", "classic") end)
    assert P.wire(<<1, 0>>) == <<1, 0>>
    assert P.decode(<<79, 0>>) == {:ok, {:request_position_update, %{}}, <<>>}
  end
end
