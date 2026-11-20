# Run inside the pinned Elixir server: mix run --no-start /path/to/run.exs
# Credentials come from the environment and are never printed.
unless System.get_env("AO_PROTOCOL_PROFILE") == "classic" do
  raise "Set AO_PROTOCOL_PROFILE=classic for this launcher"
end

port = String.to_integer(System.get_env("AO_PORT", "17666"))
db_port = String.to_integer(System.get_env("AO_DB_PORT", "55432"))
Application.put_env(:ao_tcp_gateway, :port, port)
Application.put_env(:ao_tcp_gateway, :ws_port, port + 1)
Application.put_env(:arena, :boot_mode, :lazy)
Application.put_env(:arena, ArenaWeb.Endpoint,
  Keyword.put(Application.fetch_env!(:arena, ArenaWeb.Endpoint), :server, false))
Application.put_env(:game_backend, GameBackend.Repo,
  Keyword.merge(Application.fetch_env!(:game_backend, GameBackend.Repo),
    hostname: "127.0.0.1", port: db_port, database: "ao_client_real", pool_size: 10,
    show_sensitive_data_on_connection_error: false))
Logger.configure(level: :info)

Mix.Task.run("ecto.create")
Mix.Task.run("ecto.migrate")
{:ok, _} = Application.ensure_all_started(:game_backend)
Mix.Task.run("app.start")

username = System.fetch_env!("AO_EMAIL")
password = System.fetch_env!("AO_PASSWORD")
{:ok, account} = GameBackend.Account.get_or_create(username, password)

if GameBackend.Characters.list_for_account(account.id) == [] do
  {:ok, entity} = Arena.CharacterCreation.create(%{
    name: "Macwalker", race: 1, gender: 1, class: 6, head: 1, home_city: 1,
    account_id: account.id
  })
  {:ok, _character} = GameBackend.Characters.create(
    GameBackend.Characters.from_entity(entity),
    inventory: GameBackend.Characters.inventory_from_entity(entity),
    equipment: GameBackend.Characters.equipment_from_entity(entity),
    skills: GameBackend.Characters.skills_from_entity(entity),
    spells: GameBackend.Characters.spells_from_entity(entity))
end

IO.puts("REAL AO COMMUNITY SERVER: lambdaclass/argentum; classic profile; TCP 127.0.0.1:#{port}")
IO.puts("Database persistence and original CSM map collision enabled. No stand-in.")
Process.sleep(:infinity)
